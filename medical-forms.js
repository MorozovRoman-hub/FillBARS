(function (scope) {
    'use strict';
    const titles = { palliative: 'Заключение ВК для паллиативной помощи', cec: 'КЭК — представление и заключение', histology: 'Гистология — направление 014/у и протокол 014-1/у', military: 'Выписка для военнослужащих', commission: 'Заключение врачебной комиссии', referral: 'Направление — форма 057/у-04', oncology: 'Извещение о впервые выявленном новообразовании', tmk: 'Заявка на телемедицинскую консультацию', skt: 'Направление на СКТ', operationConsent: 'Согласие на операцию', anesthesiaConsent: 'Согласие на анестезию', colonoscopyConsent:'Согласие на колоноскопию', bronchoscopyConsent:'Согласие на бронхоскопию', gastroscopyConsent:'Согласие на гастроскопию', thrombolysisConsent:'Согласие на тромболизис', operationProtocol:'Протокол операции', workInjury315:'Медицинское заключение 315-1/у', workInjury316:'Медицинское заключение 316-1/у', epidemicInvestigation:'Карта эпидемиологического расследования', centralCatheter:'Протокол катетеризации центральной вены' };
    const oncologyChoiceSections = [
        {id:'sex',title:'05. Пол',rows:[16]},
        {id:'residence',title:'08. Житель',rows:[21]},
        {id:'stage',title:'16. Стадия опухолевого процесса',rows:[32,33,34,35]},
        {id:'metastases',title:'17. Локализация отдалённых метастазов',rows:[37,38,39,40,41],multiple:true},
        {id:'confirmation',title:'18. Метод подтверждения диагноза',rows:[43,44,45],multiple:true},
        {id:'detection',title:'19. Обстоятельства выявления опухоли',rows:[47,48,49,50]}
    ];
    const labels = { fullName:'ФИО пациента',surname:'Фамилия',firstName:'Имя',patronymic:'Отчество',birthDate:'Дата рождения',medicalOrganization:'Медицинская организация',organizationAddress:'Адрес организации',department:'Отделение',doctorName:'Врач',doctorPhone:'Телефон врача',doctorPosition:'Должность врача',documentDate:'Дата документа',documentNumber:'Номер документа',passport:'Документ: тип, серия, номер, кем и когда выдан',policyNumber:'Полис ОМС',snils:'СНИЛС',insurer:'Страховая организация',registeredAddress:'Адрес регистрации',actualAddress:'Фактический адрес',diagnosis:'Диагноз',icdCode:'Код МКБ',rank:'Воинское звание',startDate:'Начало лечения',endDate:'Окончание лечения',healthGroup:'Группа состояния здоровья',destination:'Куда направлен пациент',benefitCode:'Код льготы',patientPhone:'Телефон пациента',socialStatus:'Социальный статус',disability:'Инвалидность',workPlace:'Место работы и должность',vmpCode:'Код профиля и вида ВМП',purpose:'Цель направления',diseaseCourse:'Характер заболевания',referralKind:'Первичное / повторное направление',escortNeeded:'Нужно ли сопровождение',escort:'Сопровождающий: ФИО, паспорт',transport:'Способ транспортировки и обоснование',departmentHead:'Заведующий отделением',commissionChair:'Председатель врачебной комиссии',ogrn:'ОГРН',referralReason:'Обоснование направления',addressExtra:'Дополнение к адресу',firstVisitDate:'Первое обращение',diagnosisDate:'Дата установления диагноза',tumorNumber:'Порядковый номер опухоли',morphology:'Морфологический тип',tnm:'TNM',adminRepresentative:'Представитель администрации',careSetting:'Условия оказания помощи',requestType:'Тип запроса',consultationKind:'Вид консультации',specialty:'Специальность',concomitantDiagnosis:'Сопутствующие диагнозы',attachments:'Прилагаемые документы' };
    Object.assign(labels,{ethnicGroup:'Этническая группа',postalCode:'Почтовый индекс',professionalGroup:'Профессиональная группа',historyNumber:'Номер истории болезни',clinicalInfo:'Дополнительные клинические сведения',studyRestrictions:'Ограничения к исследованию',anatomicArea:'Область исследования',studyType:'Вид рентгенологического или СКТ исследования',studyPurpose:'Цель исследования',doctorContacts:'Телефон и электронная почта врача',birthYear:'Год рождения',address:'Адрес регистрации',operationName:'Название операции',age:'Возраст',protocolNumber:'Номер протокола',operationStart:'Начало операции',operationEnd:'Окончание операции',operationDuration:'Продолжительность операции',operationCode:'Код операции',bloodGroupAbo:'Группа крови ABO',bloodGroupRh:'Резус-фактор',risk:'Операционный риск',operationPlan:'План операции',operationDescription:'Описание операции',intraoperativeComplications:'Интраоперационные осложнения',equipment:'Использованное оборудование',instrumentCount:'Инструменты — результат подсчёта',swabCount:'Салфетки — результат подсчёта',bloodLoss:'Кровопотеря',anesthesia:'Анестезия',postopDiagnosis:'Послеоперационный диагноз',assistantDoctor:'Ассистент',anesthesiologist:'Анестезиолог'});
    Object.assign(labels,{employer:'Работодатель',injurySeverity:'Степень тяжести повреждения',finalDiagnosis:'Заключительный диагноз',organizationHead:'Руководитель медицинской организации',procedureStart:'Начало процедуры',procedureEnd:'Окончание процедуры',procedureDuration:'Длительность процедуры, мин'});
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const dateText = value => String(value || '').replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3.$2.$1');
    function excelDate(value) {
        const m = dateText(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!m) return null;
        const date = new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
        if (date.getUTCFullYear() !== +m[3] || date.getUTCMonth() !== +m[2]-1 || date.getUTCDate() !== +m[1]) return null;
        return (date.getTime() - Date.UTC(1899,11,30)) / 86400000;
    }
    function createFile(template, values) {
        values = {...template.fieldDefaults, ...values};
        const decoder = new TextDecoder(), encoder = new TextEncoder();
        return scope.__FillBARSOfficeExport__.createZip(template.entries.map(entry => {
            const bytes = Uint8Array.from(atob(entry.data), char => char.charCodeAt(0));
            if (!/\.(xml|rels)$/.test(entry.name)) return {name:entry.name,data:bytes};
            let xml = decoder.decode(bytes);
            const remainingValues = {...values};
            if(template.extension==='docx'&&entry.name==='word/document.xml'){
                const escapeText = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
                for(const [field,value] of Object.entries(values)){
                    if(typeof value!=='string'||!/[\r\n]/.test(value)) continue;
                    const token=`{{${field}}}`;
                    if(!xml.includes(token)) continue;
                    xml=xml.split(token).join(value.split(/\r\n?|\n/).map(escapeText).join('</w:t><w:br/><w:t xml:space="preserve">'));
                    delete remainingValues[field];
                }
            }
            if (template.extension === 'xlsx' && entry.name === 'xl/worksheets/sheet1.xml') {
                for (const [cell,field] of Object.entries(template.dateCells || {})) {
                    const serial = excelDate(values[field]);
                    if (serial === null) continue;
                    const pattern = new RegExp(`<((?:[\\w]+:)?c)\\b([^>]*\\br="${cell}"[^>]*)>[\\s\\S]*?<\\/\\1>`);
                    xml = xml.replace(pattern, (_match, tag, attrs) => {
                        const prefix = tag.includes(':') ? tag.split(':')[0]+':' : '';
                        return `<${tag}${attrs.replace(/\s+t="[^"]*"/,'')}><${prefix}v>${serial}</${prefix}v></${tag}>`;
                    });
                }
            }
            xml = scope.__FillBARSOfficeExport__.fillXml(xml, remainingValues);
            return {name:entry.name,data:encoder.encode(xml)};
        }));
    }
    const api = {createFile,excelDate,dateText,titles}; scope.__FillBARSMedicalForms__=api;
    if (typeof module !== 'undefined') module.exports=api;
    if (!scope.document?.getElementById('fields')) return;
    const params = new URLSearchParams(location.search), key=params.get('payload');
    let payload={};
    try { if(key?.startsWith('fillbars-medical-')) {payload=JSON.parse(localStorage.getItem(key)||'{}');localStorage.removeItem(key);if(Date.now()-Date.parse(payload.generatedAt)>600000)payload={};} } catch (_) { /* Blank form remains available. */ }
    const kind=params.get('template'), template=scope.__FillBARSMedicalTemplates__[kind];
    if (!template) { document.getElementById('notice').textContent='Неизвестный шаблон.'; document.getElementById('download').disabled=true;return; }
    const patient=payload.patient||{}, now=new Date();
    const values={...patient, documentDate:dateText(patient.appointmentDate||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`),birthDate:dateText(patient.birthDate),birthYear:String(patient.birthDate||'').match(/\b(?:19|20)\d{2}\b/)?.[0]||'',address:patient.registeredAddress||'',startDate:dateText(patient.startDate),endDate:dateText(patient.endDate),doctorContacts:[patient.doctorPhone,patient.doctorEmail].filter(Boolean).join(', ')};
    for(const field of template.manualFields||[]) values[field]='';
    for(const [field,value] of Object.entries(template.fieldDefaults||{})) values[field]=value;
    if(kind==='operationProtocol'){
        values.instrumentCount='Посчитаны, счёт сходится.';
        values.swabCount='Посчитаны, счёт сходится.';
    }
    const birthMatch=values.birthDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if(birthMatch){const birth=new Date(+birthMatch[3],+birthMatch[2]-1,+birthMatch[1]);const today=new Date();if(birth.getFullYear()===+birthMatch[3]&&birth.getMonth()===+birthMatch[2]-1&&birth.getDate()===+birthMatch[1]) values.age=String(today.getFullYear()-birth.getFullYear()-(today.getMonth()<birth.getMonth()||(today.getMonth()===birth.getMonth()&&today.getDate()<birth.getDate())?1:0));}
    const names=String(patient.fullName||'').split(/\s+/);
    for (const [i,field] of ['surname','firstName','patronymic'].entries()) values[field] ||= names[i]||'';
    values.passport=[patient.passportType,patient.passportSeries,patient.passportNumber,patient.passportIssuer,patient.passportDate].filter(Boolean).join(' ');
    document.title=titles[kind];document.getElementById('title').textContent=titles[kind];
    const consentNotice='Черновик согласия из предоставленного вами образца. Проверьте актуальность и применимость текста в вашей медицинской организации. Вид вмешательства, решения, дата согласия и подписи не заполняются автоматически; пациент или представитель подписывает документ после информирования.';
    if(kind.endsWith('Consent')) document.getElementById('notice').textContent=consentNotice;
    if(kind==='palliative') document.getElementById('notice').textContent='В решение ВК подставлен стандартный текст о признании пациента нуждающимся в паллиативной медицинской помощи. Его можно отредактировать. Заполните осмотр, рекомендации и состав комиссии, проверьте бланк перед печатью и подписанием.';
    if(kind==='cec') document.getElementById('notice').textContent='КЭК на одном книжном листе А4: сверху представление, снизу заключение, по одному экземпляру. Решения о нетрудоспособности, МСЭ, прогнозе и цели направления заполняются вручную.';
    if(kind==='histology') document.getElementById('notice').textContent='В образце две страницы: направление 014/у и протокол 014-1/у. Проверьте сведения пациента и данные о материале. Протокол исследования заполняет лаборатория; даты забора, фиксация и заключение автоматически не определяются.';
    if(kind==='operationProtocol') document.getElementById('notice').textContent='Черновик протокола: описание операции необходимо сверить с фактически выполненным вмешательством, а предзаполненную запись о совпадении счёта инструментов и салфеток — с фактическим подсчётом до печати. Неподтверждённые сведения исправьте или удалите.';
    if(kind==='workInjury315'||kind==='workInjury316') document.getElementById('notice').textContent='Заключение по форме 315-1/у или 316-1/у: степень тяжести, окончательный диагноз и подпись не определяются автоматически. Проверьте данные и заполните их после медицинской оценки.';
    if(kind==='epidemicInvestigation') document.getElementById('notice').textContent='Карта эпидемиологического расследования: автоматически подставлены только имеющиеся сведения о пациенте. Выводы расследования и остальные разделы заполняет ответственный специалист.';
    if(kind==='centralCatheter') document.getElementById('notice').textContent='Черновик протокола катетеризации и согласия. Место доступа, техника, показания, осложнения и подписи не определяются автоматически; проверьте каждую страницу.';
    if(patient.patientDataWarning) document.getElementById('notice').textContent += ' '+patient.patientDataWarning;
    document.getElementById('download').textContent='Скачать '+template.extension.toUpperCase();
    const container=document.getElementById('fields'), preview=document.getElementById('preview');preview.className=kind;
    const sourceLayout=scope.__FillBARSMedicalPrintLayouts__?.[kind];
    const sourceImage=kind==='centralCatheter';
    if(kind==='operationProtocol') document.body.classList.add('operation-editor');
    const printFields=[];
    let printFrame;
    if(sourceLayout){
        document.body.classList.add('source-layout');
        document.querySelector('.preview-note').textContent='Предпросмотр и печать построены по разметке исходного Word-бланка. При длинном тексте проверьте переносы и число страниц перед печатью.';
        printFrame=document.createElement('iframe');
        printFrame.className='source-preview-frame';
        printFrame.title='Предпросмотр исходного бланка';
        if(sourceLayout.landscape) printFrame.style.width='calc(297mm + 24px)';
        printFrame.setAttribute('sandbox','allow-same-origin allow-modals');
        printFrame.addEventListener('load',()=>{
            try{printFrame.style.height=Math.max(1123,printFrame.contentDocument.documentElement.scrollHeight+8)+'px';}
            catch(_){printFrame.style.height=(sourceLayout.pages*1160)+'px';}
        });
        preview.append(printFrame);
    }
    if(sourceImage){
        document.body.classList.add('operation-print','central-catheter-print');
        const slots=[
            [['fullName',7.4,14.85,85,'1. ФИО пациента '],['doctorName',7.4,16.7,85,'2. ФИО врача (ей) '],['historyNumber',7.4,18.55,85,'3. Медицинская карта № '],['department',7.4,20.4,85,'4. Название отделения '],['catheterTimeLine',7.4,22.2,87,''],['doctorName',7.4,66.25,50,'ФИО врача ', ' подпись __________'],['doctorName',7.4,82.75,50,'ФИО врача ', ' подпись __________']],
            [['fullName',16,20.9,25],['department',33,20.9,17],['medicalOrganization',48,20.9,42],['diagnosis',32,31.15,53],['doctorName',67,53.9,22]]
        ];
        for(let pageNumber=1;pageNumber<=2;pageNumber++){
            const page=document.createElement('div');page.className='source-print-page';
            const artwork=document.createElement('img');artwork.src=`images/central-catheter-page-${pageNumber}.png`;artwork.alt=`Протокол катетеризации — страница ${pageNumber}`;
            page.append(artwork);
            for(const [field,left,top,width,prefix='',suffix=''] of slots[pageNumber-1]){
                const value=document.createElement('span');value.className='source-print-value central-value';value.dataset.field=field;
                Object.assign(value.style,{left:left+'%',top:top+'%',width:width+'%',maxWidth:width+'%'});
                page.append(value);printFields.push([field,value,prefix,suffix]);
            }
            preview.append(page);
        }
    }
    const refresh=()=>{
        if(sourceLayout){
            printFrame.srcdoc=sourceLayout.html.replace(/\{\{(\w+)\}\}/g,(_match,field)=>escape(values[field]||''));
        }
        else if(sourceImage){
            for(const [field,element,prefix,suffix] of printFields){
                element.textContent=field==='catheterTimeLine'
                    ? `5. Дата, время: ${values.documentDate||''}. Начало ${values.procedureStart||''}. Окончание ${values.procedureEnd||''}. Длительность ${values.procedureDuration||''} мин.`
                    : (values[field] ? prefix+values[field]+suffix : '');
            }
        }
        else if(kind==='tmk') preview.innerHTML='<table>'+template.fields.map(field=>`<tr><td>${escape(labels[field]||field)}</td><td>${escape(values[field])}</td></tr>`).join('')+'</table>';
        else preview.innerHTML=template.preview.replace(/\{\{(\w+)\}\}/g,(_m,field)=>`<span class="value">${escape(values[field]||'________')}</span>`);
    };
    const choiceSectionByField=new Map();
    if(kind==='oncology') for(const section of oncologyChoiceSections){
        section.fields=Object.keys(template.checkboxes||{}).filter(field=>section.rows.some(row=>field.startsWith(`check${row}x`)));
        for(const field of section.fields) choiceSectionByField.set(field,section);
    }
    for(const field of template.fields){
        if(template.fieldSections?.[field]){
            const heading=document.createElement('h2');heading.className='field-section-title';heading.textContent=template.fieldSections[field];container.append(heading);
        }
        if(kind==='operationProtocol'&&field==='operationName'){
            const wrapper=document.createElement('div');wrapper.className='choice-section';
            const heading=document.createElement('label');heading.htmlFor='operationDraft';heading.textContent='Шаблон операции';
            const select=document.createElement('select');select.id='operationDraft';
            for(const [index,item] of [{name:'Выберите шаблон…'},...(scope.__FillBARSOperationCatalog__||[])].entries()){
                const option=document.createElement('option');option.value=index?String(index-1):'';option.textContent=item.name;select.append(option);
            }
            select.addEventListener('change',()=>{if(!select.value)return;const item=scope.__FillBARSOperationCatalog__?.[+select.value];if(!item)return;values.operationName=item.name;values.operationDescription=item.text;for(const key of ['operationName','operationDescription']){const input=document.getElementById(key);if(input)input.value=values[key];}refresh();});
            wrapper.append(heading,select);container.append(wrapper);
        }
        const section=choiceSectionByField.get(field);
        if(section){
            if(field!==section.fields[0]) continue;
            const wrapper=document.createElement('div');wrapper.className='choice-section';
            const heading=document.createElement('label');heading.htmlFor=`oncology-${section.id}`;heading.textContent=section.title;
            const select=document.createElement('select');select.id=`oncology-${section.id}`;select.name=section.id;
            const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=section.multiple?'Добавить вариант…':'Выберите вариант…';select.append(placeholder);
            for(const key of section.fields){
                values[key]=values[key]==='☑'?'☑':'□';
                const option=document.createElement('option');option.value=key;option.textContent=template.checkboxes[key];select.append(option);
            }
            const selected=document.createElement('div');selected.className='selected-choices';
            const updateSelected=()=>{
                selected.replaceChildren();
                if(!section.multiple) return;
                for(const key of section.fields.filter(key=>values[key]==='☑')){
                    const chip=document.createElement('button');chip.type='button';chip.className='choice-chip';
                    chip.textContent=`${template.checkboxes[key]} ×`;
                    chip.setAttribute('aria-label',`Убрать: ${template.checkboxes[key]}`);
                    chip.addEventListener('click',()=>{values[key]='□';updateSelected();refresh();});
                    selected.append(chip);
                }
            };
            select.addEventListener('change',()=>{
                if(section.multiple){if(select.value) values[select.value]='☑';select.value='';updateSelected();}
                else for(const key of section.fields) values[key]=key===select.value?'☑':'□';
                refresh();
            });
            if(!section.multiple) select.value=section.fields.find(key=>values[key]==='☑')||'';
            wrapper.append(heading,select);
            if(section.multiple){const hint=document.createElement('small');hint.textContent='Можно выбрать несколько вариантов';wrapper.append(hint,selected);updateSelected();}
            container.append(wrapper);
            continue;
        }
        const label=document.createElement('label');const options=template.options?.[field];
        const input=document.createElement(options?'select':template.multilineFields?.includes(field)||field.includes('Address')||['diagnosis','passport','referralReason','clinicalInfo','studyRestrictions','studyPurpose','operationPlan','operationDescription','intraoperativeComplications','equipment','postopDiagnosis'].includes(field)?'textarea':'input');
        if(options) for(const choice of ['',...options]){const option=document.createElement('option');option.value=choice;option.textContent=choice.trim()||'Не выбрано';input.append(option);}
        const check=Object.hasOwn(template.checkboxes||{},field);
        label.textContent=check ? template.checkboxes[field] : template.labels?.[field]||labels[field]||field;
        input.id=field;input.name=field;label.htmlFor=field;
        if(check){ input.type='checkbox';values[field]='□'; } else input.value=values[field]||'';
        input.addEventListener('input',()=>{values[field]=check?(input.checked?'☑':'□'):input.value;refresh();});
        label.append(input);container.append(label);
    }
    document.getElementById('print').addEventListener('click',async()=>{
        if(sourceImage){
            await Promise.all([...preview.querySelectorAll('img')].map(img=>img.decode().catch(()=>undefined)));
            const clipped=[...printFields].filter(([_field,element])=>element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1).map(([field])=>labels[field]||field);
            if(clipped.length){document.getElementById('notice').textContent='Текст не помещается в строки исходного бланка: '+[...new Set(clipped)].join(', ')+'. Сократите текст или распечатайте отредактированный Word-файл.';return;}
        }
        if(sourceLayout){
            if(!printFrame.contentWindow){document.getElementById('notice').textContent='Предпросмотр ещё загружается. Повторите печать после появления страниц.';return;}
            printFrame.contentWindow.focus();printFrame.contentWindow.print();return;
        }
        window.print();
    });
    document.getElementById('download').addEventListener('click',()=>{
        try {
            const bytes=createFile(template,values);
            const mime=template.extension==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const url=URL.createObjectURL(new Blob([bytes],{type:mime})),link=document.createElement('a');
            link.href=url;link.download=`FillBARS-${kind}-${new Date().toISOString().slice(0,10)}.${template.extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error){document.getElementById('notice').textContent='Не удалось создать файл: '+error.message;}
    });
    refresh();
})(globalThis);
