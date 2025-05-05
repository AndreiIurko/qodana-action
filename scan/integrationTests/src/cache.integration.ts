import * as sinon from 'sinon';
import {main, setFailed} from '../../src/main.function'
import { setupGithubCacheMock } from './github.mock.integration';

const cachePrimaryKey = 'custom-cache-key';
const cacheRestoreKey = 'custom-cache-restore-key';
const cachePath = '/tmp/customCacheDir';

const mockUploadCache = sinon.stub<[string[], string], Promise<number>>();
const mockRestoreCache = sinon.stub<[string[], string, string[]?], Promise<string | undefined>>();

mockUploadCache.callsFake(async (paths: string[], key: string, restoreKey?: string): Promise<number> => {
  console.log(`mockUploadCache called with paths: ${paths}, key: ${key}, restoreKey: ${restoreKey}`);
  return Promise.resolve(0);
});

mockRestoreCache.callsFake(async (paths: string[], primaryKey: string): Promise<string | undefined> => {
  console.log(`mockRestoreCache called with paths: ${paths}, primaryKey: ${primaryKey}`);
  // simulate cache miss
  return Promise.resolve(cacheRestoreKey);
});

async function integrationTest() {
  setupGithubCacheMock(mockRestoreCache, mockUploadCache);

  await main();
  checkCacheRestoring();
  checkCacheSaving();
}

function checkCacheRestoring() {
  try {
    sinon.assert.calledOnce(mockRestoreCache);
    sinon.assert.calledWithExactly(mockRestoreCache, [cachePath], cachePrimaryKey, [cacheRestoreKey]);
  } catch (e) {
    setFailed((e as Error).message)
  }
}

function checkCacheSaving() {
  try {
    sinon.assert.calledOnce(mockUploadCache);
    sinon.assert.calledWithExactly(mockUploadCache, [cachePath], cachePrimaryKey);
  } catch (e) {
    setFailed((e as Error).message)
  }
}

void integrationTest()