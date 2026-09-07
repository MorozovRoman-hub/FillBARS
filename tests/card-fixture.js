'use strict';
const NAMES = { VISIT_DATE:'82638108', VISIT_TIME:'82638107', TEMPERATURE:'82638115', AD:'82638118', THSS:'82638117', THD:'82638116', S_DNEVNIK:'82638119', STAC_PLAN:'82626435', RECOMEND_CONS:'82626456' };
function buildFixture(window, options = {}) {
    const doc = window.document;
    const saved = [];
    let saveClicks = 0;
    let menuClicks = 0;
    let nextId = 100;
    const node = (tag, attrs = {}, text = '') => {
        const el = doc.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        el.textContent = text; return el;
    };
    const button = (label, action, attrs = {}) => { const el = node('button', {cmptype:'Button',...attrs}, label); el.addEventListener('click', action); return el; };
    const card = node('div', {class:'hosp_history_new'});
    card.append(node('span', {name:'PAT_FIO'}, 'Учебный Пациент Тестович'), node('span', {name:'PAT_BDATE'}, '01.01.1980'), node('span', {name:'HH_PREF_NUMB'}, 'УЧЕБНАЯ_0001-0002/0003'));
    doc.body.append(card);
    let list = null;
    let grid = null;
    function openList() {
        if (list?.isConnected) return;
        const shell = node('div', {class:'window'});
        list = node('div', {cmptype:'Form',formname:'Fixture/Observations'});
        grid = node('div', {name:'GRID_DIRECTION_OBSERVATIONS',cmptype:'Grid'});
        list.append(button('Провести осмотр', openPicker), grid); shell.append(node('h2',{},'Осмотры'), list); doc.body.append(shell);
        for (const record of saved) appendRow(record);
    }
    function appendRow(record) {
        const table = node('table'), body = node('tbody');
        const row = node('tr', {cmptype:'GridRow',keyvalue:record.id});
        row.append(node('td',{},'Учебный врач'),node('td',{},'Дневник врача'),node('td',{},record.fields.VISIT_DATE + ' ' + record.fields.VISIT_TIME));
        row.addEventListener('contextmenu', event => {
            menuClicks++;
            event.preventDefault();
            if (options.noContextMenu) return;
            const menu = node('div', {class:'fixture-menu'});
            menu.append(button('Редактировать', () => { menu.remove(); openEditor(record.fields, true); }));
            doc.body.append(menu);
        });
        body.append(row); table.append(body); grid.append(table);
    }
    function openPicker() {
        const shell = node('div', {class:'window fixture-picker'});
        const table = node('table'), body = node('tbody'), row = node('tr',{cmptype:'GridRow',keyvalue:'service1'});
        row.append(node('td',{},'Дневник врача'));
        row.addEventListener('dblclick', () => { shell.remove(); openEditor(); });
        body.append(row); table.append(body); shell.append(table); doc.body.append(shell);
    }
    function openEditor(values = {}, editing = false) {
        const shell = node('div', {class:'window'});
        const form = node('div', {cmptype:'Form',formname:'UniversalTemplate/UniversalTemplate',id:'fixture-editor-' + nextId});
        shell.append(node('h2',{},(editing ? 'Редактирование приема: ' : 'Добавление приема : ') + 'Учебный Пациент Тестович, 46 лет'), form);
        const service = node(options.directControls?'input':'div', {name:'Ctrl_SERVICE',cmptype:'ButtonEdit'}), serviceInput = options.directControls?service:node('input');
        serviceInput.value = 'Дневник врача'; if(service!==serviceInput)service.append(serviceInput);
        const disease = node(options.directControls?'input':'div', {name:'Ctrl_DISEASECASES',cmptype:'ComboBox'}), diseaseInput = options.directControls?disease:node('input');
        diseaseInput.value = 'Стационар № УЧЕБНАЯ_0001-0002/0003'; if(disease!==diseaseInput)disease.append(diseaseInput);
        if(options.hiddenControlIds&&!options.directControls){service.prepend(node('input',{type:'hidden',value:'internal-service'}));disease.prepend(node('input',{type:'hidden',value:'internal-case'}));}
        form.append(service,disease);
        for (const [semantic, name] of Object.entries(NAMES)) {
            const text = ['S_DNEVNIK','STAC_PLAN','RECOMEND_CONS'].includes(semantic);
            const wrapper = node('div',{cmptype:text?'FillingTextArea':semantic==='VISIT_DATE'?'DateEdit':'Edit',name,template_field:semantic});
            if (text) wrapper.append(node('input',{class:'fta_sinput'}));
            const input = node(text?'textarea':'input',text?{name:name+'_Text',maxlength:'4000'}:{});
            input.value = values[semantic] ?? (text?'Текст из настроек БАРС':'111');
            wrapper.append(input); form.append(wrapper);
        }
        form.append(button('Сохранить', () => {
            saveClicks++;
            if (options.saveMode === 'timeout') return;
            const fields = {};
            for (const semantic of Object.keys(NAMES)) fields[semantic] = form.querySelector('[template_field="'+semantic+'"] '+(['S_DNEVNIK','STAC_PLAN','RECOMEND_CONS'].includes(semantic)?'textarea':'input')).value;
            if (options.saveMode === 'mismatch') fields.RECOMEND_CONS += ' изменено сервером';
            const record = {id:String(nextId++),fields};
            saved.push(record); shell.remove();
            if (options.saveMode === 'no-list-row') return;
            if (options.rowDelay) window.setTimeout(()=>appendRow(record),options.rowDelay);
            else appendRow(record);
        },{name:'Btn_SaveClose',enabled:'true'}));
        form.append(button('Применить', () => { throw new Error('Неправильная кнопка сохранения'); },{name:'Btn_Save'}));
        form.append(button('Отмена',()=>shell.remove()));
        doc.body.append(shell);
        if(options.loadDelay){
            const originals=[...form.querySelectorAll('[template_field] input,[template_field] textarea')].map(input=>({input,value:input.value}));
            const serviceValue=serviceInput.value,diseaseValue=diseaseInput.value;
            serviceInput.value='';diseaseInput.value='';
            for(const item of originals){item.input.value='';item.input.readOnly=true;}
            window.setTimeout(()=>{
                if(!form.isConnected)return;
                serviceInput.value=serviceValue;diseaseInput.value=diseaseValue;
                for(const item of originals){item.input.value=item.value;item.input.readOnly=false;}
            },options.loadDelay);
        }
        if(options.inheritAfterFill){
            let scheduled=false;
            form.addEventListener('input',()=>{
                if(scheduled||editing)return;scheduled=true;
                window.setTimeout(()=>{
                    if(!form.isConnected)return;
                    for(const semantic of Object.keys(NAMES))form.querySelector('[template_field="'+semantic+'"] '+(['S_DNEVNIK','STAC_PLAN','RECOMEND_CONS'].includes(semantic)?'textarea':'input')).value='Унаследованное значение';
                },4);
            });
        }
        return form;
    }
    card.append(button('Осмотры',openList));
    const visible = el => !!el?.isConnected && !el.closest('[hidden]') && el.style.display !== 'none';
    return { card, openList, openEditor, visible, saved, get saveClicks(){return saveClicks;}, get menuClicks(){return menuClicks;}, get grid(){return grid;} };
}
module.exports = { buildFixture, NAMES };
