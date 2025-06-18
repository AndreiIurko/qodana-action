import * as core from '@actions/core'
import {main, setFailed} from '../../src/main.function'
import * as sinon from 'sinon'
import {execSpy, setupGithubMock, getDefaultGithubContext} from './github.mock.integration'
import {QODANA_SARIF_NAME} from '../../../common/qodana'
import path from 'path'
import * as fs from 'fs'


type LinterCode = 'android' | 'jvm-android' | 'php' | 'js' | 'dotnet' | 'cpp' | 'cdnet' | 'python' | 'python-community' | 'go' | 'jvm' | 'jvm-community' | 'clang' | 'ruby'

type InputArgs = {
  os: string,
  linter: LinterCode,
  prMode: boolean,
  useCaches: boolean,
  withFixes: string
}

// function getLinterImage(linterCode: LinterCode): string {
//   return `jetbrains/qodana-${linterCode}:2025.1`;
// }
//
// function getLinterDirectory(linterCode: LinterCode): string {
//   switch (linterCode) {
//     case 'python':
//     case 'python-community':
//       return 'py_error';
//     case 'dotnet':
//     case 'cdnet':
//       return 'dotnet';
//     case 'cpp':
//       return 'cpp';
//     case 'clang':
//       return 'cnova';
//     case 'js':
//       return 'js';
//     case 'go':
//       return 'go';
//     case 'ruby':
//       return 'ruby';
//     case 'php':
//       return 'duplicates';
//     case 'jvm':
//     case 'jvm-community':
//     case 'android':
//     case 'jvm-android':
//     default:
//       return 'java';
//   }
// }

// Run the integration test for a specific matrix combination
export async function runMatrixTest(
  matrix: InputArgs
): Promise<void> {

  const issues = {
    listComments: sinon.stub().resolves({ data: [] }),
    createComment: sinon.stub().resolves(undefined),
    updateComment: sinon.stub().resolves(undefined)
  };

  const reactions = {
    listForIssue: sinon.stub().resolves({ data: [] }),
    deleteForIssue: sinon.stub().resolves(undefined),
    createForIssue: sinon.stub().resolves(undefined)
  };

  const checks = {
    listForRef: sinon.stub().resolves({ data: { check_runs: [] } }),
    create: sinon.stub().resolves(undefined),
    update: sinon.stub().resolves(undefined)
  };

  const defaultContext = getDefaultGithubContext();
  setupGithubMock(issues, reactions, checks, defaultContext);
  core.info("Starting main function")
  await main();

  execSpy.getCalls().forEach(call => {
    core.info(`Got call with arguments ${call.args}`)
  })
  checkInputs(matrix)

  //const resultsDir = getInputsSpy.returnValues[0].resultsDir
  const resultsDir = process.env.RUNNER_TEMP ? `${process.env.RUNNER_TEMP}/qodana/results` : '/tmp/qodana/results'
  const sarifSourcePath = path.join(resultsDir, QODANA_SARIF_NAME);

  if (fs.existsSync(sarifSourcePath)) {
    const sarifDestDir = path.join(__dirname, '../integrationTests/testData');
    const sarifFileName = `qodana_${matrix.os}_${matrix.linter}_pr-${matrix.prMode}_cache-${matrix.useCaches}_fixes-${matrix.withFixes}.sarif.json`;
    const sarifDestPath = path.join(sarifDestDir, sarifFileName)
    if (!fs.existsSync(sarifDestDir)) {
      fs.mkdirSync(sarifDestDir, {recursive: true})
    }
    fs.copyFileSync(sarifSourcePath, sarifDestPath);
    console.log(`Saved SARIF file to ${sarifDestPath}`);
  } else {
    console.warn(`SARIF file not found at ${sarifSourcePath}`);
  }

  cleanup()
}

function cleanup() {
  execSpy.resetHistory()
  //getInputsSpy.resetHistory()
}

function checkInputs(matrix: InputArgs) {
  const expectedInputs = {
    // args: [],
    // resultsDir: process.env.RUNNER_TEMP ? `${process.env.RUNNER_TEMP}/qodana/results` : '/tmp/qodana/results',
    // cacheDir: process.env.RUNNER_TEMP ? `${process.env.RUNNER_TEMP}/qodana/cache` : '/tmp/qodana/cache',
    // primaryCacheKey: 'qodana-cache',
    // additionalCacheKey: '',
    // cacheDefaultBranchOnly: false,
    // uploadResult: true,
    // uploadSarif: false,
    // artifactName: 'qodana-report',
    useCaches: matrix.useCaches,
    useAnnotations: false,
    prMode: matrix.prMode,
    postComment: false,
    // githubToken: 'fake-token',
    // pushFixes: 'none',
    // commitMessage: 'Qodana fixes',
    // useNightly: false
  };

  // assert(
  //   getInputsSpy.returned(sinon.match(expectedInputs)),
  //   `The input args for Qodana action mismatched. Expected:\n${expectedInputs}\nmatrix: ${matrix}`
  // )
}

function assert(check: boolean, message: string) {
  if (!check) {
    setFailed(message)
  }
}

async function runTest(): Promise<void> {
  const matrixJson = process.env.MATRIX_JSON;
  core.info(`got ${matrixJson}`)
  if (matrixJson == undefined) {
    setFailed("Could not read input arguments from process.env.MATRIX_JSON")
    return
  }
  const matrix: InputArgs = JSON.parse(matrixJson);
  core.info(`parsed matrix: ${matrix}`)
  await runMatrixTest(matrix);
}

void runTest();
