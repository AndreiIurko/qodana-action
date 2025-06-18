import * as sinon from 'sinon';
import * as exec from '@actions/exec';
import * as Context from '@actions/github/lib/context'; // Context type definition
import * as artifact from '@actions/artifact';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as utils from '../../src/utils';

export const execSpy = sinon.spy(exec, 'getExecOutput');
// core.info("Started to initialise inputs spy:")
// export const getInputsSpy = sinon.spy(utils, 'getInputs')

export function setupGithubArtifactMock(mockArtifactUpload: sinon.SinonStub) {
  sinon.stub(artifact.default, 'uploadArtifact').callsFake(mockArtifactUpload);
}

export function setupGithubCacheMock(
  mockCacheRestore: sinon.SinonStub,
  mockCacheSave: sinon.SinonStub,
) {
  sinon.stub(cache, 'restoreCache').callsFake(mockCacheRestore);
  sinon.stub(cache, 'saveCache').callsFake(mockCacheSave);
}

export function setupGithubCoreMock(mockSummaryWrite: sinon.SinonStub) {
  const mockSummaryAddRaw = sinon.stub();
  mockSummaryAddRaw.returnsThis();
  sinon.stub(core.summary, 'addRaw').callsFake(mockSummaryAddRaw);
  sinon.stub(core.summary, 'write').callsFake(mockSummaryWrite);
}

export interface IssuesRest {
  listComments: sinon.SinonStub;
  createComment: sinon.SinonStub;
  updateComment: sinon.SinonStub;
}

export interface ReactionsRest {
  listForIssue: sinon.SinonStub;
  deleteForIssue: sinon.SinonStub;
  createForIssue: sinon.SinonStub;
}

export interface ChecksRest {
  listForRef: sinon.SinonStub;
  create: sinon.SinonStub;
  update: sinon.SinonStub;
}

export function setupGithubMock(
  issues: IssuesRest = {
    listComments: sinon.stub().resolves({ data: [] }),
    createComment: sinon.stub().resolves(undefined),
    updateComment: sinon.stub().resolves(undefined)
  },
  reactions: ReactionsRest = {
    listForIssue: sinon.stub().resolves({ data: [] }),
    deleteForIssue: sinon.stub().resolves(undefined),
    createForIssue: sinon.stub().resolves(undefined)
  },
  checks: ChecksRest = {
    listForRef: sinon.stub().resolves({ data: { check_runs: [] } }),
    create: sinon.stub().resolves(undefined),
    update: sinon.stub().resolves(undefined)
  },
  contextToUse: Context.Context
) {
  const mockOctokitClient = {
    rest: {
      issues: issues,
      reactions: reactions,
      checks: checks,
    },
  };
  sinon.stub(github, 'getOctokit').returns(mockOctokitClient as any);
  sinon.stub(github, 'context').get(() => contextToUse);
}

export function getDefaultGithubContext(): Context.Context {
  return {
    runId: 1,
    repo: {
      owner: 'Qodana',
      repo: 'Qodana-GitHub-Action'
    },
    issue: {
      number: 1,
      owner: '',
      repo: ''
    },
    ref: 'branch3',
    sha: '22222222',
    payload: {
      repository: {
        default_branch: 'branch5',
        // Not used in Qodana GHA
        name: '',
        owner: {
          login: '',
          name: ''
        }
      },
      pull_request: {
        number: 1,
        head: {
          sha: '00000000',
          ref: 'branch1'
        },
        base: {
          sha: '11111111',
          ref: 'branch2'
        }
      }
    },
    // Not used in Qodana GHA
    action: "",
    actor: "",
    apiUrl: "",
    eventName: "",
    graphqlUrl: "",
    job: "",
    runNumber: 0,
    serverUrl: "",
    workflow: "",
  }
}