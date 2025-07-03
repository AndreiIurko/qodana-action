import * as core from '@actions/core'
import {main} from '../../src/main.function'
import {cacheRestoreSpy, execSpy, setupGithubCoreMock, setupGithubMock} from './github.mock.integration'
import {EXECUTABLE, FAIL_THRESHOLD_OUTPUT, QODANA_SARIF_NAME, QodanaExitCode, VERSION} from '../../../common/qodana'
import path from 'path'
import * as fs from 'fs'
import {getInputs} from "../../lib/utils"
import {assert, expect} from 'chai'
import {LINTER_DATA} from "./constants"
import * as sinon from "sinon"
import {Run} from "sarif"
import {inspect} from "util";
import Sinon from "sinon";

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
  const setFailedStub: sinon.SinonStub<[message: string | Error], void> = sinon.stub()
  setupGithubCoreMock(undefined, setFailedStub)
  setupGithubMock()

  try {
    core.info("Starting main function")
    await main()

    // for debug purposes
    execSpy.getCalls().forEach(call => {
      const filteredArgs = call.args.filter(arg => arg != undefined)
      core.info(`Got call with arguments ${filteredArgs}`)
    })

    checkInputs(matrix)

    await Promise.all([
      checkQodanaCalls(matrix),
      checkStatus(setFailedStub),
      checkCache(),
      checkSarifAndMaybeOverride(matrix)
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
  assert(execSpy.calledOnce, errorMessage)

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
  assert(execSpy.calledTwice, errorMessage)

  const [, pullArgs] = calls[0]
  const expectedPullArgs = [
    `pull`,
    `-l,${getLinterImageWithoutVersion(matrix.linter)}`
  ]
  checkArgs(pullArgs, expectedPullArgs)

  const [, scanArgs] = calls[1]
  checkArgs(scanArgs, getExpectedScanArgs(matrix))
}

function getExpectedScanArgs(matrix: TestInputs): string[] {
  const inputs = getInputs()
  const expectedArgs: string[] = [
    'scan',
    `-i,${matrix.analysisDir}`,
    `--cache-dir,${inputs.cacheDir}`,
    `--results-dir,${inputs.resultsDir}`
  ]
  if (matrix.fixesMode != 'none') {
    expectedArgs.push(matrix.fixesMode)
  }
  if (matrix.prMode) {
    const hash = process.env.QODANA_PR_SHA
    expect(hash, `Empty QODANA_PR_SHA for analysis in pr-mode`).not.empty
    expectedArgs.push(`--commit,${hash}`)
  }
  if (matrix.mode == 'native') {
    expectedArgs.push(`--ide,${matrix.linter}`)
  } else {
    expectedArgs.push(`--linter,${getLinterImageWithoutVersion(matrix.linter)}`)
  }
  return expectedArgs
}

function checkArgs(actual: string[] | undefined, expected: string[]) {
  const argsAsString = actual?.join(',') ?? ''
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
  const failedExecution =
    qodanaExecutions.find(execution => !Object.values(QodanaExitCode).includes(execution.exitCode))
  if (failedExecution) {
    throw Error(`Qodana execution resulted in exit code ${failedExecution.exitCode}: ${failedExecution.stderr}\n${failedExecution.stdout}`)
  }

  const failedByThresholdExecution =
    qodanaExecutions.find(execution => execution.exitCode == QodanaExitCode.FailThreshold)
  if (failedByThresholdExecution) {
    assert(setFailedStub.calledWith(FAIL_THRESHOLD_OUTPUT), `Qodana exited with exit code ${QodanaExitCode.FailThreshold}, but error message was not shown`)
  }
}

async function checkCache() {
  const inputs = getInputs()
  if (inputs.useCaches) {
    assert(cacheRestoreSpy.calledOnce, `Qodana tried to restore caches twice`)
    const returnValue = await cacheRestoreSpy.firstCall.returnValue
    const errorMessage = `Cache with primary key ${inputs.primaryCacheKey} was not loaded during execution. Please check if you changed cache key`
    expect(returnValue, errorMessage).not.undefined
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

export function compareSarifFiles(actual: string, expected: string) {
  core.info(`Comparing two sarif files: ${actual} and ${expected}`)
  const actualContent = fs.readFileSync(actual, 'utf-8')
  const expectedContent = fs.readFileSync(expected, 'utf-8')

  const actualRun: Run = JSON.parse(actualContent).runs?.[0]
  const expectedRun: Run = JSON.parse(expectedContent).runs?.[0]

  assert(!actualRun || !expectedRun, `One or both SARIF files do not contain a valid run object.`)
  assert(JSON.stringify(actualRun.properties) !== JSON.stringify(expectedRun.properties), 'Properties are not the same')

  const actualResults = actualRun.results ?? []
  const expectedResults = expectedRun.results ?? []

  assert(actualResults.length !== expectedResults.length, `The results number mismatched: expected ${expectedResults.length}, got ${actualResults.length}`)

  const resultsActualSorted = actualResults.map(r => JSON.stringify(r)).sort()
  const resultsExpectedSorted = expectedResults.map(r => JSON.stringify(r)).sort()

  assert(JSON.stringify(resultsActualSorted) !== JSON.stringify(resultsExpectedSorted), `results mismatch: ${actualResults}\nexpected:\n${expectedResults}`)
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
