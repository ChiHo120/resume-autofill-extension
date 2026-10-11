import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan,validateAnalysis} from '../shared/plan.js';
const fields=[{id:'name',kind:'text'},{id:'degree',kind:'select',options:[{id:'o1'}]},{id:'consent',kind:'checkbox'}];
test('missing analysis does not require actions or valid dropdown values',()=>{
 const input={actions:[{fieldId:'degree',value:'invalid-option'}],missing:[{fieldId:'name',reason:'姓名'},{fieldId:'name',reason:'姓名'},{fieldId:'terms'},{fieldId:'unknown'}]};
 assert.deepEqual(validateAnalysis(input,[...fields,{id:'terms',protected:true}]).missing,[{fieldId:'name',reason:'姓名'}]);
 assert.deepEqual(validateAnalysis({missing:[]},fields).missing,[]);
 assert.throws(()=>validateAnalysis({},fields));
});
test('rejects unknown and duplicate fields',()=>{
 assert.throws(()=>validatePlan({actions:[{fieldId:'submit',value:'x'}]},fields));
 assert.throws(()=>validatePlan({actions:[{fieldId:'name',value:'x'},{fieldId:'name',value:'y'}]},fields));
});
test('rejects invented options and wrong boolean types',()=>{
 assert.throws(()=>validatePlan({actions:[{fieldId:'degree',value:'bachelor'}]},fields));
 assert.throws(()=>validatePlan({actions:[{fieldId:'consent',value:'true'}]},fields));
});
test('accepts valid option IDs',()=>{assert.equal(validatePlan({actions:[{fieldId:'degree',value:'o1'}]},fields).actions.length,1);});
test('accounts for every unplanned field and preserves custom dropdown facts',()=>{
 const result=validatePlan({actions:[{fieldId:'city',value:'Shanghai'}],missing:[{fieldId:'invented',reason:'ignore'}]},[{id:'city',kind:'custom-select'},{id:'age',kind:'text'},{id:'terms',kind:'checkbox',protected:true}]);
 assert.deepEqual(result.missing.map(f=>f.fieldId),['age']);
 assert.equal(result.actions[0].value,'Shanghai');
});
test('rejects protected declarations and oversized values',()=>{
 assert.throws(()=>validatePlan({actions:[{fieldId:'declaration',value:true}]},[{id:'declaration',kind:'checkbox',protected:true}]));
 assert.throws(()=>validatePlan({actions:[{fieldId:'name',value:'x'.repeat(10001)}]},fields));
});
