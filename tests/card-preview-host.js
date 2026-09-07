// Only loaded by the localhost preview. No patient site, browser extension API or network writes.
if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Только локальный предпросмотр.');
const C = window.FillBARSCardCore;
const profile = { id:'preview-general',name:'Послеоперационное наблюдение',variants:[
    {id:'pv1',title:'Первый вариант',diary:'Учебный пример для проверки интерфейса.\n\nЗдесь будет текст вашего дневника: жалобы, объективный статус и динамика состояния. Перед отправкой каждую запись можно отредактировать.',examination:'Укажите план обследования и контроль показателей.',treatment:'Укажите план лечения и рекомендации.'},
    {id:'pv2',title:'Второй вариант',diary:'Второй учебный вариант дневника.\n\nВыбранный шаблон подставляет согласованные тексты дневника, плана обследования и плана лечения.',examination:'План обследования из второго варианта.',treatment:'План лечения из второго варианта.'}
]};
let library=JSON.parse(localStorage.getItem('cardPreviewLibrary')||'null')||{type:'fillbars-card-templates',version:1,profiles:[profile]};
let settings=C.cleanSettings(JSON.parse(localStorage.getItem('cardPreviewSettings')||'{}'));
const now=C.dateParts(new Date(Date.now()-86400000));
let initial=C.createRow({profile,...now});initial.demo=true;
let state=JSON.parse(sessionStorage.getItem('cardPreviewState')||'null')||{patient:{key:'preview',fullName:'Учебная карточка',birth:'Демонстрационные данные',history:'ДЕМО / 001'},draft:{rows:[initial],defaults:{...C.DEFAULTS},profileId:profile.id,hourStep:4},run:null};
const recoveryPreview=new URLSearchParams(location.search).get('scenario')==='recovery';
if(recoveryPreview){
    const rows=['18:00','22:00'].map(time=>({...C.createRow({profile,...now,time}),demo:true}));
    state={patient:{key:'preview',fullName:'Учебная карточка',birth:'Демонстрационные данные',history:'ДЕМО / 001'},draft:{rows,defaults:{...C.DEFAULTS},profileId:profile.id,hourStep:4},run:{id:'preview-recovery',status:'uncertain',phase:'saving',index:0,rows:C.clone(rows),results:[],message:'Учебный сценарий: первая запись сохранена, ожидается подтверждение.',updatedAt:1}};
}
window.cardPreviewRequest=async message=>{
    if(message.action==='load')return {ok:true,state,library,settings};
    if(message.action==='status')return {ok:true,state};
    if(message.action==='draft'){state={...state,draft:message.draft};sessionStorage.setItem('cardPreviewState',JSON.stringify(state));return {ok:true,state};}
    if(message.action==='saveLibrary'){library=C.cleanLibrary(message.library);localStorage.setItem('cardPreviewLibrary',JSON.stringify(library));return {ok:true,library};}
    if(message.action==='saveSettings'){settings=C.cleanSettings(message.settings);localStorage.setItem('cardPreviewSettings',JSON.stringify(settings));return {ok:true,settings};}
    if(message.action==='connect')return {ok:true,state};
    if(message.action==='continue'&&recoveryPreview){
        state.draft.rows.forEach(row=>{row.status='saved';});
        Object.assign(state.run,{status:'done',phase:'done',results:state.run.rows.map((row,index)=>({rowId:row.id,verification:index?'list':'manual'})),updatedAt:Date.now(),message:'Учебная очередь завершена. Обе записи остались в окне; отправки в МИС не было.'});
        return {ok:true,state};
    }
    if(message.action==='clear'){state={patient:null,draft:null,run:null};sessionStorage.removeItem('cardPreviewState');return {ok:true,cleared:true};}
    return {ok:false,error:'Это локальный предпросмотр. В медицинскую систему ничего не отправляется.'};
};
