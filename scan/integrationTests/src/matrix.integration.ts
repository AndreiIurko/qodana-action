import * as core from '@actions/core'
import {main} from '../../src/main.function'
import {cacheRestoreSpy, execSpy, setupGithubCoreMock, setupGithubMock} from './github.mock.integration'
import {EXECUTABLE, FAIL_THRESHOLD_OUTPUT, QODANA_SARIF_NAME, QodanaExitCode} from '../../../common/qodana'
import path from 'path'
import * as fs from 'fs'
import {getInputs} from "../../lib/utils"
import {assert, expect} from 'chai'
import {LINTER_DATA} from "./constants"
import * as sinon from "sinon"
import {Run} from "sarif"
import {inspect} from "util";
import Sinon from "sinon";
import * as exec from '@actions/exec'

type LinterCode = keyof typeof LINTER_DATA
type AnalysisMode = 'native' | 'docker'

type TestInputs = {
  os: string,
  mode: AnalysisMode,
  linter: LinterCode,
  analysisDir: string,
  prMode: boolean,
  useCaches: boolean,
  fixesMode: string,
  overrideSarif: boolean
}

export async function runMatrixTest(
  matrix: TestInputs
): Promise<void> {
  const commitBeforeTest = (
    await exec.getExecOutput('git', ['rev-parse', 'HEAD'], { cwd: matrix.analysisDir })
  ).stdout.trim()
  const setFailedStub: sinon.SinonStub<[message: string | Error], void> = sinon.stub()
  setupGithubCoreMock(undefined, setFailedStub)
  setupGithubMock()

  try {
    core.info("Starting main function")
    await main()

    execSpy.getCalls().forEach(call => {
      const filteredArgs = call.args.filter(arg => arg != undefined)
      core.debug(`Got call with arguments ${filteredArgs}`)
    })

    checkInputs(matrix)

    await Promise.all([
      checkQodanaCalls(matrix),
      checkStatus(setFailedStub),
      checkCache(),
      checkSarifAndMaybeOverride(matrix),
      checkFixes(matrix, commitBeforeTest)
    ])
  } finally {
    cleanup()
  }
}

function cleanup() {
  Sinon.restore()
}

function checkInputs(matrix: TestInputs) {
  const expectedInputs = {
    useCaches: matrix.useCaches,
    useAnnotations: false,
    prMode: matrix.prMode,
    postComment: false,
    pushFixes: 'none',
    useNightly: false,
  }
  const actual = getInputs()
  core.debug(`Got inputs: ${inspect(expectedInputs)}`)
  const errorMessage =
    `The input args for Qodana action mismatched. Expected:${inspect(expectedInputs)}\nGot: ${inspect(actual)}`
  expect(actual, errorMessage).to.include(expectedInputs)
}

async function checkQodanaCalls(matrix: TestInputs) {
  if (matrix.mode == 'native') {
    checkQodanaNativeCalls(matrix)
  } else {
    checkQodanaDockerCalls(matrix)
  }
}

function checkQodanaNativeCalls(matrix: TestInputs) {
  const calls = execSpy
    .getCalls()
    .filter(call => call.args[0] == EXECUTABLE)
    .map(call => call.args)

  const errorMessage = `Qodana should be called once in native mode. Actual calls:\n${calls.join('\n')}`
  expect(calls.length).to.equal(1, errorMessage)

  const [, scanArgs] = calls[0]
  checkArgs(scanArgs, getExpectedScanArgs(matrix))
}

function getLinterImageWithoutVersion(linterCode: LinterCode): string {
  return `jetbrains/qodana-${LINTER_DATA[linterCode].linter}`
}

function checkQodanaDockerCalls(matrix: TestInputs) {
  const calls = execSpy
    .getCalls()
    .filter(call => call.args[0] == EXECUTABLE)
    .map(call => call.args)

  const errorMessage = `Qodana should be called twice in docker mode. Actual calls:\n${calls.join('\n')}`
  expect(calls.length).to.equal(2, errorMessage)

  const [, pullArgs] = calls[0]
  const expectedPullArgs = [
    `pull`,
    `-l ${getLinterImageWithoutVersion(matrix.linter)}`
  ]
  core.debug(`Expected pull args: ${inspect(expectedPullArgs)}`)
  checkArgs(pullArgs, expectedPullArgs)

  const [, scanArgs] = calls[1]
  checkArgs(scanArgs, getExpectedScanArgs(matrix))
}

function getExpectedScanArgs(matrix: TestInputs): string[] {
  const inputs = getInputs()
  const expectedArgs: string[] = [
    'scan',
    `-i ${matrix.analysisDir}`,
    `--cache-dir ${inputs.cacheDir}`,
    `--results-dir ${inputs.resultsDir}`
  ]
  if (matrix.fixesMode != 'none') {
    expectedArgs.push(matrix.fixesMode)
  }
  // if (matrix.prMode) {
  //   const hash = TODO: add variable to
  //   expect(hash, `Empty QODANA_PR_SHA for analysis in pr-mode`).not.empty
  //   expectedArgs.push(`--commit ${hash}`)
  // }
  if (matrix.mode == 'native') {
    expectedArgs.push(`--ide ${matrix.linter}`)
  } else {
    expectedArgs.push(`--linter ${getLinterImageWithoutVersion(matrix.linter)}`)
  }
  core.debug(`Expected scan args: ${inspect(expectedArgs)}`)
  return expectedArgs
}

function checkArgs(actual: string[] | undefined, expected: string[]) {
  const argsAsString = actual?.join(' ') ?? ''
  expected.forEach(arg => {
    expect(argsAsString).contain(arg, `Could not find argument ${arg} in execution: ${argsAsString}`)
  })
}

async function checkStatus(setFailedStub: sinon.SinonStub<[message: string | Error], void>) {
  const qodanaExecutions = await Promise.all(
    execSpy
      .getCalls()
      .filter(call => call.args[0] == EXECUTABLE)
      .map(call => call.returnValue)
  )
  core.debug(`All qodana ExecOutput objects: ${inspect(qodanaExecutions)}`)
  const failedExecution =
    qodanaExecutions.find(execution => !Object.values(QodanaExitCode).includes(execution.exitCode))
  if (failedExecution) {
    throw Error(`Qodana execution resulted in exit code ${failedExecution.exitCode}.\nStderr: ${failedExecution.stderr}\nStdout: ${failedExecution.stdout}`)
  }

  const failedByThresholdExecution =
    qodanaExecutions.find(execution => execution.exitCode == QodanaExitCode.FailThreshold)
  if (failedByThresholdExecution) {
    assert(
      setFailedStub.calledWith(FAIL_THRESHOLD_OUTPUT),
      `Qodana exited with exit code ${QodanaExitCode.FailThreshold}, but error message was not shown`
    )
  }
}

async function checkCache() {
  const inputs = getInputs()
  if (inputs.useCaches) {
    assert(cacheRestoreSpy.calledOnce, `Qodana tried to restore caches twice`)
    const returnValue = await cacheRestoreSpy.firstCall.returnValue
    const errorMessage = `Cache with primary key ${inputs.primaryCacheKey} was not loaded during execution. Please check if you changed cache key`
    expect(returnValue, errorMessage).not.undefined.and.not.empty
  }
}

function getSarifName(matrix: TestInputs) {
  return `qodana_${matrix.os}_${matrix.mode}_${matrix.linter}_pr-${matrix.prMode}_cache-${matrix.useCaches}_fixes-${matrix.fixesMode}.sarif.json`
}

function getSarifSourcePath() {
  return path.join(getInputs().resultsDir, QODANA_SARIF_NAME)
}

async function checkSarifAndMaybeOverride(matrix: TestInputs) {
  const sarifSourcePath = getSarifSourcePath()
  const overrideSarif = matrix.overrideSarif
  if (fs.existsSync(sarifSourcePath)) {
    const sarifDestDir = path.join(__dirname, '../integrationTests/testData')
    const sarifDestPath = path.join(sarifDestDir, getSarifName(matrix))
    if (overrideSarif) {
      if (!fs.existsSync(sarifDestDir)) {
        fs.mkdirSync(sarifDestDir, { recursive: true })
      }
      fs.copyFileSync(sarifSourcePath, sarifDestPath)
    } else {
      try {
        compareSarifFiles(sarifSourcePath, sarifDestPath)
      } catch (e) {
        core.warning("To regenerate sarif files content, launch workflow manually with parameter `override-sarif` set to `true`")
        throw e
      }
    }
  } else {
    throw Error(`SARIF file not found at ${sarifSourcePath}`)
  }
}

/**
 * Checks only results and properties of run object
 * @param actual sarif file after run
 * @param expected expected results and properties
 */
function compareSarifFiles(actual: string, expected: string) {
  core.info(`Comparing two sarif files: ${actual} and ${expected}`)
  const actualContent = fs.readFileSync(actual, 'utf-8')
  const expectedContent = fs.readFileSync(expected, 'utf-8')

  const actualRun: Run = JSON.parse(actualContent).runs?.[0]
  const expectedRun: Run = JSON.parse(expectedContent).runs?.[0]
  core.debug(`Actual run:\n${inspect(actualRun)}`)
  core.debug(`Expected run:\n${inspect(expectedRun)}`)

  assert(actualRun && expectedRun, `One or both SARIF files do not contain a valid run object.`)
  const errorMessage = `Properties are not the same. 
    Actual${inspect(actualRun.properties)}
    Expected${inspect(expectedRun.properties)}`
  expect(actualRun.properties).to.deep.equal(expectedRun.properties, errorMessage)

  const actualResults = actualRun.results ?? []
  const expectedResults = expectedRun.results ?? []

  expect(actualResults.length).to.equal(expectedResults.length, `The results number mismatched: expected ${expectedResults.length}, got ${actualResults.length}`)
  expect(actualRun.results).to.deep.equal(expectedRun.results, `results mismatch:\nActual${inspect(actualResults)}\nExpected:\n${inspect(expectedResults)}`)
}

async function checkFixes(matrix: TestInputs, commitBeforeFixes: string) {
  if (matrix.fixesMode == 'none') {
    return
  }
  const gitDiff = (
    await exec.getExecOutput('git', ['diff', commitBeforeFixes], { cwd: matrix.analysisDir })
  ).stdout.trim()
  core.info(gitDiff)
}

function getMatrix(): TestInputs {
  const matrixJson = process.env.MATRIX_JSON
  core.info(`Test args: ${matrixJson}`)
  if (matrixJson == undefined) {
    throw Error("Could not read input arguments from process.env.MATRIX_JSON")
  }
  return JSON.parse(matrixJson)
}

async function runTest(): Promise<void> {
  try {
    await runMatrixTest(getMatrix())
  } catch (e) {
    core.setFailed((e as Error).message)
  }
}

void runTest()
