'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.version,'5.2.6');
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);
assert(!manifest.host_permissions && !manifest.externally_connectable);
for(const asset of [...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon)]){
    assert(!asset.startsWith('./') && !asset.includes('\\'), 'Icon path must match ZIP entry exactly: '+asset);
    assert(fs.existsSync(path.join(root,asset)), 'Missing manifest icon: '+asset);
}
for(const file of ['diary-core.js','diary-background.js','diary-bars-adapter.js','diary-launch.js','diary-window.js','diaries.js','background.js']){
    new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
}
for(const html of ['popup.html','diaries.html']){
    const content=fs.readFileSync(path.join(root,html),'utf8');
    for(const [,src] of content.matchAll(/(?:src|href)="([^"]+)"/g)){
        if(src.startsWith('http')||src.startsWith('#'))continue;
        assert(fs.existsSync(path.join(root,src.split('#')[0])),html+': missing '+src);
    }
}
const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
// Background images are referenced from CSS, not HTML src/href attributes.
for(const file of fs.readdirSync(root).filter(name=>/\.(html|css)$/.test(name))){
    const content=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,value] of content.matchAll(/url\(\s*([^)]*?)\s*\)/g)){
        const asset=value.replace(/^["']|["']$/g,'').trim();
        if(/^(?:data:|https?:|#)/i.test(asset))continue;
        assert(fs.existsSync(path.join(root,asset.split(/[?#]/)[0])),file+': missing CSS asset '+asset);
    }
}
assert(popup.indexOf('id="openDiaries"')>popup.indexOf('id="openTransfusionProtocol"'));
assert(popup.indexOf('id="openDiaries"')<popup.indexOf('id="saveJournalEntry"'));
const model=require('../diary-core');
const adapter=require('../diary-bars-adapter');
assert.deepEqual(adapter.FIELD_NAMES,Object.keys(model.fields({...model.createRow(),diary:'Текст'})));
console.log('Manifest, scripts, assets, popup entry and field contract: OK');
