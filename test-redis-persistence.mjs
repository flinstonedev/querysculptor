import { loadQueryState, saveQueryState, generateSessionId } from './tools/shared-utils.js';

async function testRedisPersistence() {
  try {
    const testSessionId = generateSessionId();
    console.log('Test session ID:', testSessionId);
    
    const testState = { 
      sessionId: testSessionId,
      headers: {},
      operationType: 'query',
      operationTypeName: 'Query',
      queryStructure: { fields: {}, fragmentSpreads: [], inlineFragments: [] },
      fragments: {},
      variablesSchema: {},
      variablesDefaults: {},
      variablesValues: {},
      operationDirectives: []
    };
    
    await saveQueryState(testSessionId, testState);
    console.log('State saved to Redis');
    
    const loaded = await loadQueryState(testSessionId);
    console.log('State loaded:', loaded ? 'SUCCESS' : 'FAILED');
    
    if (loaded) {
      console.log('Session ID from loaded state:', loaded.sessionId);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testRedisPersistence();