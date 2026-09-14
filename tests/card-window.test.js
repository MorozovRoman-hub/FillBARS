'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
    const session={},windows=new Map(),created=[],updates=[],messages=[];
    let listener,removed,sequence=100;
    const chrome={
        runtime:{id:'test',getURL:file=>'chrome-extension://test/'+file,onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>{messages.push(message);return {ok:true};}},
        storage:{session:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,value),remove:async key=>{delete session[key];}}},
        windows:{
            // Deliberately no URLs: the installed extension has no tabs permission.
            create:async options=>{const item={id:++sequence,type:'popup',state:'normal'};created.push(options);windows.set(item.id,item);return item;},
            get:async id=>{if(!windows.has(id))throw new Error('Window closed');return {...windows.get(id)};},
            update:async(id,options)=>{updates.push({id,...options});Object.assign(windows.get(id),options);return windows.get(id);},
            onRemoved:{addListener:fn=>{removed=fn;}}
        }
    };
    const restart=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../diary-window.js'),'utf8'),{chrome});
    restart();
    const send=(action,data={},sender={id:'test',url:'chrome-extension://test/diaries.html?tab=1'})=>new Promise(resolve=>listener({namespace:'fillbars-card-window-v1',action,...data},sender,resolve));
    return {session,windows,created,updates,messages,restart,send,close:id=>{windows.delete(id);removed(id);}};
}
test('повторное открытие восстанавливает свёрнутое окно без доступа к URL вкладок',async()=>{
    const app=setup();const first=await app.send('open',{tabId:1});
    app.windows.get(first.windowId).state='minimized';
    const second=await app.send('open',{tabId:1});
    assert.equal(first.windowId,second.windowId);assert.equal(app.created.length,1);
    assert(app.updates.some(update=>update.state==='normal'));assert(app.updates.some(update=>update.focused));
});
test('два одновременных нажатия создают ровно одно окно',async()=>{
    const app=setup();const results=await Promise.all([app.send('open',{tabId:1}),app.send('open',{tabId:1})]);
    assert.equal(app.created.length,1);assert.equal(results[0].windowId,results[1].windowId);
});
test('остановка service worker не теряет ID существующего окна',async()=>{
    const app=setup();const first=await app.send('open',{tabId:1});app.restart();
    assert.equal((await app.send('open',{tabId:1})).windowId,first.windowId);assert.equal(app.created.length,1);
});
test('после закрытия окна создаётся одно новое',async()=>{
    const app=setup();const first=await app.send('open',{tabId:1});app.close(first.windowId);
    const second=await app.send('open',{tabId:1});assert.notEqual(second.windowId,first.windowId);assert.equal(app.windows.size,1);
});
test('восстановленное браузером окно регистрируется и не дублируется',async()=>{
    const app=setup();app.windows.set(50,{id:50,type:'popup',state:'normal'});
    assert.equal((await app.send('register',{windowId:50})).registered,true);
    assert.equal((await app.send('open',{tabId:1})).windowId,50);assert.equal(app.created.length,0);
    app.windows.set(51,{id:51,type:'popup',state:'normal'});
    assert.equal((await app.send('register',{windowId:51})).duplicate,true);
});
test('другая вкладка направляется в существующий редактор, без перезагрузки его черновика',async()=>{
    const app=setup();await app.send('open',{tabId:1});await app.send('open',{tabId:2});
    assert.equal(app.created.length,1);assert.equal(app.messages.at(-1).tabId,2);
});
test('страница БАРС не может создавать окна командами расширению',async()=>{
    const app=setup();const result=await app.send('open',{tabId:1},{id:'test',url:'http://fixture.invalid'});
    assert.equal(result.ok,false);assert.equal(app.created.length,0);
});
