/* Read-only, patient-scoped access to BARS history, constitution and lab datasets. */
(function(scope){
    'use strict';
    const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
    const pageOf=(element,name)=>element?.form?.page||element?.jsParent?.page||element?.DForm?.page
        ||[...(scope.SYS_pages||[]),...(scope.SYS_pages_window||[])].find(item=>item?.form?.name===name&&item.form.containerForm?.contains(element))?.form;
    const get=(page,name)=>{try{return tidy(page?.getVar?.(name));}catch(_){return '';}};
    const caption=(page,element,name)=>{try{return tidy(page?.getCaption?.(name)||element?.querySelector(`[name="${name}"]`)?.textContent);}catch(_){return '';}};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    function resultLines(row){
        return String(row.RES||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'')
            .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\u00a0/g,' ').split(/[;\n]/);
    }
    function creatinineFromRows(rows){
        for(const row of rows){
            const raw=String(row.RES||'');
            if(!raw||!/<|креатинин/i.test(raw))continue;
            for(const line of resultLines(row)){
                if(/креатинин\s+(?:мочи|в\s+моче|суточной)/i.test(line))continue;
                const match=line.match(/(?:^|\s)креатинин(?:\s+\([^)]{0,45}\))?(?:\s+в\s+сыворотке)?\s*[:—-]\s*(\d+(?:[,.]\d+)?)\s*(мкмоль\s*\/\s*л|ммоль\s*\/\s*л|µmol\s*\/\s*l|μmol\s*\/\s*l|umol\s*\/\s*l|mmol\s*\/\s*l|мг\s*\/\s*дл|mg\s*\/\s*dl)(?=$|\s|[,;])/i);
                if(match)return {creatinine:match[1].replace(',','.'),creatinineUnit:match[2].replace(/\s/g,''),creatinineDate:tidy(row.SVISIT_DATE||row.SREG_DATE||''),labService:tidy(row.SERVICE_NAME||'')};
            }
        }
        return {};
    }
    function hemoglobinFromRows(rows){
        for(const row of rows){
            if(!/гемоглобин/i.test(String(row.RES||'')))continue;
            for(const line of resultLines(row)){
                const match=line.match(/(?:^|\s)гемоглобин\s*[:—-]\s*(\d+(?:[,.]\d+)?)\s*(г\s*\/\s*л|g\s*\/\s*l|г\s*\/\s*дл|g\s*\/\s*dl)(?=$|\s|[,;])/i);
                if(match)return {hemoglobin:match[1].replace(',','.'),hemoglobinUnit:match[2].replace(/\s/g,''),hemoglobinDate:tidy(row.SVISIT_DATE||row.SREG_DATE||''),hemoglobinService:tidy(row.SERVICE_NAME||'')};
            }
        }
        return {};
    }
    function glucoseFromRows(rows){
        for(const row of rows){
            if(!/глюкоза/i.test(String(row.RES||'')))continue;
            for(const line of resultLines(row)){
                if(/глюкоза\s+(?:в\s+)?моч[иеы]/i.test(line))continue;
                const match=line.match(/(?:^|\s)глюкоза(?:\s+(?:крови|в\s+сыворотке|в\s+плазме))?\s*[:—-]\s*(\d+(?:[,.]\d+)?)\s*(ммоль\s*\/\s*л|mmol\s*\/\s*l|мг\s*\/\s*дл|mg\s*\/\s*dl)(?=$|\s|[,;])/i);
                if(match)return {glucose:match[1].replace(',','.'),glucoseUnit:match[2].replace(/\s/g,''),glucoseDate:tidy(row.SVISIT_DATE||row.SREG_DATE||''),glucoseService:tidy(row.SERVICE_NAME||'')};
            }
        }
        return {};
    }
    function weightFromRows(rows){
        for(const row of rows){
            const name=tidy(row.ANTHROP_NAME||row.ANTHROP).toLowerCase();
            if(!/^(?:масса\s+тела|вес(?:\s+тела)?)(?:\s*\([^)]*\))?$/.test(name))continue;
            const unit=tidy(row.MEAS).toLowerCase();
            const value=tidy(row.A_VALUE).replace(',','.');
            if(!/^(?:кг\.?|kg)$/.test(unit)||!/^\d+(?:\.\d+)?$/.test(value))continue;
            const weight=Number(value);
            if(weight>=2&&weight<=400)return {weight:String(weight),weightSource:'Общие сведения'};
        }
        return {};
    }
    async function read({timeout=8000}={}){
        try{if(scope.frameElement?.hasAttribute('data-fillbars-background')||scope.frameElement?.hasAttribute('data-fillbars-patient-details'))return {historyFound:false};}catch(_){return {historyFound:false};}
        const allHistories=Array.from(scope.document.querySelectorAll('.hosp_history_new')).filter(element=>element.isConnected);
        const visibleHistories=allHistories.filter(element=>{
            const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&scope.getComputedStyle(element).visibility!=='hidden';
        });
        // BARS may hide the history underneath its laboratory/overview modal.
        // A hidden history is safe only when it is the sole loaded history.
        const histories=visibleHistories.length?visibleHistories:allHistories;
        if(histories.length>1)return {historyFound:true,error:'Открыто несколько историй болезни. Оставьте одну активную историю.'};
        const history=histories[0],page=pageOf(history,'ArmPatientsInDep/hosp_history_new');
        if(!history||!page)return {historyFound:false};
        const ids=['AGENT','PERSMEDCARD','HH_ID'].map(name=>get(page,name));
        if(ids.some(id=>!id))return {historyFound:true,error:'Не загружены идентификаторы истории болезни.'};
        const identity=()=>['AGENT','PERSMEDCARD','HH_ID'].map(name=>get(page,name)).join('|');
        const original=identity();
        const current=()=>history.isConnected&&identity()===original;
        const birthDate=caption(page,history,'PAT_BDATE').match(/\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}/)?.[0]||'';
        const data={historyFound:true,sex:caption(page,history,'PAT_SEX')||get(page,'NSEX'),birthDate,warnings:[]};
        function openRows(selector,formName,datasetName){
            for(const element of scope.document.querySelectorAll(selector)){
                const candidate=pageOf(element,formName);
                if(get(candidate,'PERSMEDCARD')!==ids[1])continue;
                const rows=candidate?.getDataSet?.(datasetName,false)?.data;
                if(Array.isArray(rows)&&rows.length)return rows.slice();
            }
            return [];
        }
        async function dataset(formName,datasetName,count){
            if(!current())throw new Error('Пациент изменился во время чтения исследований.');
            if(typeof scope.openWindow!=='function'||typeof scope.closeWindow!=='function')return [];
            let child=null;
            try{
                const vars={AGENT:ids[0],AGENT_ID:ids[0],PERSMEDCARD:ids[1],HH_ID:ids[2],HH_DEP_ID:get(page,'HH_DEP_ID'),DISEASECASE:get(page,'DISEASECASE'),DISEASE_HISTORY_PK_ID:get(page,'PAYMENT_KIND_ID')};
                child=scope.openWindow({name:formName,vars,oncreate(){const c=this?.page||child;try{const dom=c?.getContainer?.()?.GetMainDOM?.();if(dom)dom.style.cssText='visibility:hidden!important;pointer-events:none!important';}catch(_){/* Container not attached yet. */}}},true,1,1);
                const end=Date.now()+timeout;
                let ds=null;
                while(Date.now()<end&&current()){
                    ds=child?.getDataSet?.(datasetName,false);
                    if(ds&&typeof child?.refreshDataSet==='function')break;
                    await wait(100);
                }
                if(!current())throw new Error('Пациент изменился во время чтения исследований.');
                if(!ds||typeof ds.setData!=='function')return [];
                if(count&&typeof child.setVar==='function'){
                    child.setVar('ancnt',count);child.setVar('anst',1);
                }
                let completed=false;
                const dataEnd=Date.now()+timeout;
                const originalSet=ds.setData;
                ds.setData=function(...args){const result=originalSet.apply(this,args);completed=true;return result;};
                try{
                    child.refreshDataSet(datasetName);
                    while(!completed&&Date.now()<dataEnd&&current())await wait(100);
                    if(!current())throw new Error('Пациент изменился во время чтения исследований.');
                    return completed&&Array.isArray(ds.data)?ds.data.slice():[];
                }finally{if(ds.setData!==originalSet)ds.setData=originalSet;}
            }catch(error){if(!current())throw error;data.warnings.push(datasetName+': '+String(error.message||error));return [];}
            finally{try{if(child&&!child.destroyed)scope.closeWindow(null,child);}catch(_){/* Already closed by BARS. */}}
        }
        const constitution=openRows('.patients_information','ArmPatientsInDep/patients_information','DS_CONSITUTION_SPS')
            ||[];
        if(!constitution.length)constitution.push(...await dataset('ArmPatientsInDep/patients_information','DS_CONSITUTION_SPS'));
        Object.assign(data,weightFromRows(constitution));
        const labs=openRows('.wrap_analyses','ArmPatientsInDep/Wrappers/analyses','DS_ANALYSES');
        if(!labs.length)labs.push(...await dataset('ArmPatientsInDep/Wrappers/analyses','DS_ANALYSES',100));
        data.labHistory={creatinine:[],hemoglobin:[],glucose:[]};
        for(const row of labs){
            for(const [key,parse] of [['creatinine',creatinineFromRows],['hemoglobin',hemoglobinFromRows],['glucose',glucoseFromRows]]){
                const result=parse([row]);
                if(result[key])data.labHistory[key].push({value:result[key],unit:result[key+'Unit'],date:result[key+'Date'],service:result[key+'Service']||result.labService||''});
            }
        }
        data.labHistoryRowCount=labs.length;
        Object.assign(data,creatinineFromRows(labs));
        Object.assign(data,hemoglobinFromRows(labs));
        Object.assign(data,glucoseFromRows(labs));
        if(!current())throw new Error('Пациент изменился во время чтения исследований.');
        if(!data.weight)data.warnings.push('Масса тела не найдена в Общих сведениях. Проверьте осмотр приёмного отделения или введите её вручную.');
        if(!data.creatinine)data.warnings.push('Креатинин с единицей измерения не найден среди последних 100 лабораторных направлений.');
        if(!data.hemoglobin)data.warnings.push('Гемоглобин с единицей измерения не найден среди последних 100 лабораторных направлений.');
        if(!data.glucose)data.warnings.push('Глюкоза с единицей измерения не найдена среди последних 100 лабораторных направлений.');
        return data;
    }
    const api={read,creatinineFromRows,hemoglobinFromRows,glucoseFromRows,weightFromRows};scope.FillBARSKidneyBars=api;
    if(typeof module!=='undefined')module.exports=api;
})(globalThis);
