import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBaseUrl,permissionOrigin,validateConfig,parseModels,parseJsonResponse,validateProfile,requestApi,chatJson} from '../shared/api.js';
test('remote HTTP and endpoint normalization',()=>{
 assert.equal(normalizeBaseUrl(' http://example.com/v1/ '),'http://example.com/v1');
 assert.equal(normalizeBaseUrl('https://example.com/v1/chat/completions'),'https://example.com/v1');
 assert.equal(permissionOrigin('http://localhost:8123/v1'),'http://localhost/*');
 for(const url of ['ftp://example.com','https://user:pass@example.com','https://example.com?q=x'])assert.throws(()=>normalizeBaseUrl(url));
});
test('models require key but do not require a selected model',()=>{
 assert.equal(validateConfig({baseUrl:'http://example.com/v1',apiKey:'test'},false).model,'');
 assert.throws(()=>validateConfig({baseUrl:'http://example.com/v1',apiKey:'test'}));
 assert.deepEqual(parseModels({data:[{id:'b'},{id:'a'},{id:'b'},{id:1}]}),['a','b']);
 assert.throws(()=>parseModels({models:[]}));
});
test('JSON response and profile validation',()=>{
 assert.deepEqual(parseJsonResponse('```json\n{"basic":{"fullName":"Demo"}}\n```'),{basic:{fullName:'Demo'}});
 assert.throws(()=>parseJsonResponse('not json'));
 assert.throws(()=>validateProfile({basic:{fullName:''}}));
 assert.equal(validateProfile({basic:{fullName:'Demo'}}).basic.fullName,'Demo');
});
test('API requests use requested HTTP address and preserve server model ID',async()=>{
 const config={baseUrl:'http://example.com/v1',apiKey:'test-only',model:'exact Model ID'};
 let captured;
 const fetcher=async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({choices:[{message:{content:'{"actions":[]}'}}]})};};
 await chatJson(config,[],fetcher);
 assert.equal(captured.url,'http://example.com/v1/chat/completions');
 assert.equal(JSON.parse(captured.options.body).model,'exact Model ID');
 assert.equal(captured.options.redirect,'error');
 assert.equal(captured.options.headers.Authorization,'Bearer test-only');
 await assert.rejects(()=>requestApi(config,'/models',undefined,async()=>({ok:false,status:401})),/401/);
});
