import {ExecOptions, ExecOutput} from '@actions/exec/lib/interfaces'
import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import artifact from '@actions/artifact'
import * as github from '@actions/github'
import {GitHub} from '@actions/github/lib/utils'
import * as core from '@actions/core'
import {Conclusion, Output} from './annotations'
import * as io from '@actions/io'
import {AnnotationProperties} from '@actions/core'

interface QodanaGithubApi {
  info(message: string): void

  warning(message: string, properties?: AnnotationProperties): void

  error(message: string, properties?: AnnotationProperties): void

  notice(message: string, properties?: AnnotationProperties): void

  mkdirP(p: string): Promise<void>

  addPath(inputPath: string): void

  restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[]
  ): Promise<string | undefined>

  saveCache(paths: string[], key: string): Promise<number>

  getExecOutput(
    commandLine: string,
    args?: string[],
    options?: ExecOptions
  ): Promise<ExecOutput>

  uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string
  ): Promise<void>

  getComments(
    client: InstanceType<typeof GitHub>
  ): Promise<{id: number; body?: string | undefined}[]>

  postSummary(summary: string): Promise<void>

  createCheck(
    client: InstanceType<typeof GitHub>,
    conclusion: Conclusion,
    head_sha: string,
    name: string,
    output: Output
  ): Promise<void>

  updateCheck(
    client: InstanceType<typeof GitHub>,
    conclusion: Conclusion,
    check_run_id: number,
    output: Output
  ): Promise<void>

  setFailed(message: string): void

  //putReaction(newReaction: Reaction, oldReaction: string): void;

  //downloadTool(arch: string, platform: string, useNightly: boolean): string;
}

class QodanaGithubApiImpl implements QodanaGithubApi {
  info(message: string): void {
    core.info(message)
  }

  warning(message: string, properties?: AnnotationProperties): void {
    core.warning(message, properties)
  }

  error(message: string, properties?: AnnotationProperties): void {
    core.error(message, properties)
  }

  notice(message: string, properties?: AnnotationProperties): void {
    core.error(message, properties)
  }

  async mkdirP(p: string): Promise<void> {
    await io.mkdirP(p)
  }

  addPath(inputPath: string): void {
    core.addPath(inputPath)
  }

  async restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[]
  ): Promise<string | undefined> {
    return cache.restoreCache(paths, primaryKey, restoreKeys)
  }

  async saveCache(paths: string[], key: string): Promise<number> {
    return cache.saveCache(paths, key)
  }

  async getExecOutput(
    commandLine: string,
    args?: string[],
    options?: ExecOptions
  ): Promise<ExecOutput> {
    return exec.getExecOutput(commandLine, args, options)
  }

  async uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string
  ): Promise<void> {
    await artifact.uploadArtifact(name, files, rootDirectory)
  }

  async getComments(
    client: InstanceType<typeof GitHub>
  ): Promise<{id: number; body?: string | undefined}[]> {
    const {data: comments} = await client.rest.issues.listComments({
      ...github.context.repo,
      issue_number: github.context.issue.number
    })
    return comments
  }

  async postSummary(summary: string): Promise<void> {
    await core.summary.addRaw(summary).write()
  }

  /**
   * Updates a GitHub Check.
   * @param client The Octokit REST API client to be used for updating the Check.
   * @param conclusion The conclusion to use for the GitHub Check.
   * @param check_run_id The ID of the GitHub Check to use for the update.
   * @param output The Check Output to use.
   */
  async updateCheck(
    client: InstanceType<typeof GitHub>,
    conclusion: Conclusion,
    check_run_id: number,
    output: Output
  ): Promise<void> {
    await client.rest.checks.update({
      ...github.context.repo,
      accept: 'application/vnd.github.v3+json',
      status: 'completed',
      conclusion,
      check_run_id,
      output
    })
  }

  /**
   * Creates a GitHub Check.
   * @param client The Octokit REST API client to be used for creating the Check.
   * @param conclusion The conclusion to use for the GitHub Check.
   * @param head_sha The SHA of the head commit.
   * @param name The name of the Check.
   * @param output The Check Output to use.
   */
  async createCheck(
    client: InstanceType<typeof GitHub>,
    conclusion: Conclusion,
    head_sha: string,
    name: string,
    output: Output
  ): Promise<void> {
    await client.rest.checks.create({
      ...github.context.repo,
      accept: 'application/vnd.github.v3+json',
      status: 'completed',
      head_sha,
      conclusion,
      name,
      output
    })
  }

  setFailed(message: string): void {
    core.setFailed(message)
  }
}

class QodanaGithubApiTest implements QodanaGithubApi {
  info(message: string): void {
    core.info(message)
  }

  warning(message: string): void {
    core.info(`warning: ${message}`)
  }

  error(message: string): void {
    core.info(`error: ${message}`)
  }

  notice(message: string): void {
    core.info(`notice: ${message}`)
  }

  addPath(inputPath: string): void {
    core.info(`addPath ${inputPath}`)
    core.addPath(inputPath)
  }

  async mkdirP(p: string): Promise<void> {
    core.info(`mkdirP ${p}`)
    return Promise.resolve()
  }

  async restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[]
  ): Promise<string | undefined> {
    core.info(
      `restoreCache ${paths.join(',')} with primary key ${primaryKey} and restore keys ${restoreKeys?.join(',')}`
    )
    return Promise.resolve(undefined)
  }

  async getExecOutput(
    commandLine: string,
    args?: string[],
    options?: ExecOptions
  ): Promise<ExecOutput> {
    core.info(
      `exec ${commandLine} ${args?.join(' ')} with options ${JSON.stringify(options)}`
    )
    return exec.getExecOutput(commandLine, args, options)
    // return Promise.resolve({exitCode: 0, stdout: '', stderr: ''})
  }

  async uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string
  ): Promise<void> {
    core.info(
      `uploadArtifact ${name} with files ${files.join(',')} and root directory ${rootDirectory}`
    )
    return Promise.resolve()
  }

  async saveCache(paths: string[], key: string): Promise<number> {
    core.info(`saveCache ${paths.join(',')} with key ${key}`)
    return Promise.resolve(0)
  }

  async getComments(): Promise<{id: number; body?: string | undefined}[]> {
    core.info(`getComments`)
    return Promise.resolve([])
  }

  async postSummary(summary: string): Promise<void> {
    core.info(`postSummary ${summary}`)
    return Promise.resolve()
  }

  async updateCheck(
    _client: InstanceType<typeof GitHub>,
    conclusion: Conclusion,
    check_run_id: number,
    output: Output
  ): Promise<void> {
    core.info(
      `updateCheck ${conclusion} with check run id ${check_run_id} and output ${JSON.stringify(output)}`
    )
    return Promise.resolve()
  }

  async createCheck(
    _client: InstanceType<typeof GitHub>,
    conclusion: Conclusion,
    head_sha: string,
    name: string,
    output: Output
  ): Promise<void> {
    core.info(
      `createCheck ${conclusion} with head sha ${head_sha} and name ${name} and output ${JSON.stringify(output)}`
    )
    return Promise.resolve()
  }

  setFailed(message: string): void {
    core.info(`setFailed ${message}`)
  }
}

const QODANA_TEST_MODE_ENV_VAR = 'QODANA_INTERNAL_TEST_MODE'

let _qodanaGithubApi: QodanaGithubApi | undefined = undefined

export const qodanaGithubApi = getQodanaGithubApi()

export function getQodanaGithubApi(): QodanaGithubApi {
  if (_qodanaGithubApi === undefined) {
    if (process.env[QODANA_TEST_MODE_ENV_VAR] === 'true') {
      _qodanaGithubApi = new QodanaGithubApiTest()
    } else {
      _qodanaGithubApi = new QodanaGithubApiImpl()
    }
  }
  return _qodanaGithubApi
}
