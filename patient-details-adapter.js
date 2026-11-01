(function(scope) {
    'use strict';
    const VERSION='5.2.43', CARD='Persmedcard/persmedcard_edit';
    const normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
    function pageOf(card,win) {
        const direct=card?.form?.page||card?.jsParent?.page||card?.DForm?.page;
        if(direct)return direct;
        if(typeof card?.form?.getVar==='function')return card.form;
        return [...(win.SYS_pages||[]),...(win.SYS_pages_window||[])].find(p=>p?.form?.name===CARD&&p.form.containerForm?.contains(card))?.form;
    }
    async function read({window=scope,context,isCurrent,timeout=25000,loadEnvironment}={}) {
        if(!context?.agentId||!context?.medicalCardId)throw new Error('В истории ещё не загружены идентификаторы пациента. Повторите после загрузки истории.');
        let dispose=()=>{},dialog=false;const restore=[];
        const guard=()=>{if(!isCurrent())throw new Error('Пациент изменился во время получения реквизитов.');if(dialog)throw new Error('БАРС запросил подтверждение при чтении карточки. Автозаполнение остановлено.');};
        const wait=async(check,stage)=>{const end=Date.now()+timeout;while(Date.now()<end){guard();const value=check();if(value)return value;await new Promise(resolve=>window.setTimeout(resolve,100));}throw new Error('Не удалось автоматически получить '+stage+'. Повторите запрос.');};
        const matches=page=>{try{return normalize(page?.getVar?.('AGENT'))===context.agentId&&normalize(page?.getVar?.('PERSMEDCARD'))===context.medicalCardId;}catch(_){return false;}};
        try {
            guard();
            let owner=window;
            let card=Array.from(window.document.querySelectorAll('.persmedcard_edit')).find(el=>matches(pageOf(el,window)));
            if(!card){
                if(loadEnvironment){const loaded=await loadEnvironment();owner=loaded.window;dispose=loaded.dispose;}
                else {
                    // A private parent isolates BARS loading indicators and inherited variables.
                    const host=window.document.createElement('iframe');host.setAttribute('data-fillbars-patient-details',VERSION);
                    host.setAttribute('aria-hidden','true');host.tabIndex=-1;host.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');
                    host.style.cssText='position:fixed!important;left:-20000px!important;top:0!important;width:1440px!important;height:1000px!important;opacity:0!important;pointer-events:none!important;border:0!important;';
                    window.document.body.append(host);dispose=()=>host.remove();
                    const doc=host.contentDocument,spinner=doc.createElement('spinner-ctrl');
                    spinner.show=()=>spinner.setAttribute('aria-busy','true');spinner.hide=()=>spinner.setAttribute('aria-busy','false');doc.body.append(spinner);
                    host.contentWindow.D3Api={misDesktopApp:window.D3Api?.misDesktopApp};
                    const frame=doc.createElement('iframe');frame.setAttribute('data-fillbars-patient-details',VERSION);frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');frame.style.cssText='width:1440px;height:1000px;border:0';
                    frame.src=window.location.origin+'/';doc.body.append(frame);
                    owner=await wait(()=>{try{return frame.contentDocument.readyState!=='loading'&&typeof frame.contentWindow.openWindow==='function'?frame.contentWindow:null;}catch(_){return null;}},'среду БАРС');
                }
                owner.alert=()=>{dialog=true;};owner.confirm=()=>{dialog=true;return false;};owner.prompt=()=>{dialog=true;return null;};owner.open=()=>{dialog=true;return null;};
                guard();
                // Normal card initialization performs read queries and the standard access audit only.
                // Never press OK/Save or call UPDATE_FULL / address equality setters.
                owner.openWindow(owner.JSON.parse(JSON.stringify({name:CARD,vars:{PERSMEDCARD:context.medicalCardId,AGENT:context.agentId,PRIMARY:''}})),true);
                card=await wait(()=>Array.from(owner.document.querySelectorAll('.persmedcard_edit')).find(el=>matches(pageOf(el,owner))),'карточку пациента');
            }
            const page=pageOf(card,owner);
            const control=name=>{
                const element=card.querySelector(`[name="${name}"]`);
                const input=element?.matches('input,textarea,select')?element:element?.querySelector('input,textarea,select');
                return normalize(input?.value||element?.textContent||'');
            };
            await wait(()=>matches(page)&&control('SURNAME'),'основные данные пациента');
            if(typeof page.getDataSet!=='function'||typeof page.refreshDataSet!=='function')throw new Error('БАРС не предоставил источники данных карточки.');
            // These exact dataset names and columns come from Agents/subforms_view/*.frm.
            // Legacy DControlEvent stringifies callbacks, losing their closure. Observe setData
            // instead, so empty results are distinguished from requests still loading.
            const names=['DS_PERSDOCS','DS_REAL_ADDRS','DS_REG_ADDRS','DS_POLIS_OMS'];
            const loaded=new Set(),datasets={};
            for(const name of names){
                const ds=page.getDataSet(name,false);
                if(typeof ds?.setData!=='function')throw new Error('В карточке недоступен источник '+name);
                datasets[name]=ds;const original=ds.setData;
                const wrapped=function(...args){const result=original.apply(this,args);loaded.add(name);return result;};
                ds.setData=wrapped;restore.push(()=>{if(ds.setData===wrapped)ds.setData=original;});
                page.refreshDataSet(name);
            }
            await wait(()=>names.every(name=>loaded.has(name)),'паспорт, адрес и полис');
            guard();if(!matches(page))throw new Error('Реквизиты получены для другого пациента.');
            const first=name=>{
                const data=datasets[name].data;
                if(data?.sys_error)throw new Error('Ошибка чтения источника '+name);
                if(!Array.isArray(data))throw new Error('Некорректный ответ источника '+name);
                if(data.length>1)throw new Error('Неоднозначный ответ источника '+name);
                return data[0]||{};
            };
            const passport=first('DS_PERSDOCS'),actual=first('DS_REAL_ADDRS'),registered=first('DS_REG_ADDRS'),policy=first('DS_POLIS_OMS');
            const surname=control('SURNAME'),firstName=control('FIRSTNAME'),patronymic=control('LASTNAME');
            return {surname,firstName,patronymic,fullName:[surname,firstName,patronymic].filter(Boolean).join(' '),birthDate:control('BIRTHDATE'),
                snils:control('SNILS'),policyNumber:control('ENP')||normalize([policy.P_SER,policy.P_NUM].filter(Boolean).join(' ')),insurer:normalize(policy.P_WHO),
                passportType:normalize(passport.PD_TYPE),passportSeries:normalize(passport.PD_SER),passportNumber:normalize(passport.PD_NUMB),
                passportIssuer:normalize(passport.PD_WHO),passportDate:normalize(passport.PD_WHEN),
                actualAddress:normalize(actual.ADR_FULL),registeredAddress:normalize(registered.ADR_FULL),
                patientDataWarning:!passport.PD_NUMB?'В БАРС нет действующего документа, удостоверяющего личность.':''};
        } finally { for(const reset of restore)reset();dispose(); }
    }
    const api={version:VERSION,read,pageOf};scope.FillBARSPatientDetails=api;
    if(typeof module!=='undefined')module.exports=api;
})(globalThis);
