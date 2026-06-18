function getPayloadKey() {
    return new URLSearchParams(window.location.search).get('payload') || '';
}

function readPayload() {
    const key = getPayloadKey();
    if (!key) {
        return null;
    }

    try {
        const rawPayload = localStorage.getItem(key);
        localStorage.removeItem(key);
        return rawPayload ? JSON.parse(rawPayload) : null;
    } catch (error) {
        console.error('Не удалось открыть лист назначений', error);
        return null;
    }
}

function formatDate(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString('ru-RU');
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value || '';
    }
}

function medicationToText(medication) {
    return [
        medication?.name,
        medication?.form,
        medication?.dose,
        medication?.route,
        medication?.frequency,
        medication?.duration,
        medication?.regimen,
        medication?.comment
    ].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
}

function procedureToText(procedure) {
    const details = [procedure?.name, procedure?.comment]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' — ');
    return details ? `Диагностическое/режимное назначение: ${details}` : '';
}

function appendMedicationRows(medications, procedures, appointmentDate) {
    const body = document.getElementById('medicationRows');
    body.textContent = '';

    const assignments = [
        ...procedures.map((procedure) => ({ text: procedureToText(procedure) })),
        ...medications.map((medication) => ({ text: medicationToText(medication) }))
    ];
    const minRows = 14;
    const rows = Math.max(minRows, assignments.length);

    for (let index = 0; index < rows; index += 1) {
        const row = document.createElement('tr');
        const assignment = assignments[index];

        const nameCell = document.createElement('td');
        nameCell.className = 'medication-text';
        nameCell.textContent = assignment?.text || '';
        row.appendChild(nameCell);

        const dateCell = document.createElement('td');
        dateCell.textContent = assignment ? appointmentDate : '';
        row.appendChild(dateCell);

        row.appendChild(document.createElement('td'));

        for (let executionColumn = 0; executionColumn < 15; executionColumn += 1) {
            row.appendChild(document.createElement('td'));
        }

        row.appendChild(document.createElement('td'));
        body.appendChild(row);
    }

    const controlRow = document.createElement('tr');
    controlRow.className = 'control-signature-row';

    const controlLabel = document.createElement('td');
    controlLabel.colSpan = 3;
    controlLabel.textContent = 'Подпись медицинского работника, ответственного за контроль исполнения назначений';
    controlRow.appendChild(controlLabel);

    for (let column = 0; column < 16; column += 1) {
        const cell = document.createElement('td');
        cell.className = 'signature-cell';
        controlRow.appendChild(cell);
    }

    body.appendChild(controlRow);
}

function appendAnalysisRows(analyses, appointmentDate) {
    const body = document.getElementById('analysisRows');
    body.textContent = '';

    const minRows = 28;
    const rows = Math.max(minRows, analyses.length);

    for (let index = 0; index < rows; index += 1) {
        const row = document.createElement('tr');
        const analysis = analyses[index];

        const nameCell = document.createElement('td');
        nameCell.textContent = analysis ? analysis.name || `Исследование ${analysis.id}` : '';
        row.appendChild(nameCell);

        const dateCell = document.createElement('td');
        dateCell.textContent = analysis ? appointmentDate : '';
        row.appendChild(dateCell);

        row.appendChild(document.createElement('td'));
        row.appendChild(document.createElement('td'));
        row.appendChild(document.createElement('td'));
        body.appendChild(row);
    }
}

function render(payload) {
    if (!payload) {
        document.getElementById('printRoot').innerHTML = '<section class="sheet"><h1>Лист назначений не найден</h1><p>Откройте печатную форму из popup FillBARS повторно.</p></section>';
        return;
    }

    const patient = payload.patient || {};
    const appointmentDate = formatDate(patient.appointmentDate || payload.generatedAt);

    setText('patientFullName', patient.fullName);
    setText('patientBirthDate', formatDate(patient.birthDate));

    appendMedicationRows(
        Array.isArray(payload.medications) ? payload.medications : [],
        Array.isArray(payload.procedures) ? payload.procedures : [],
        appointmentDate
    );
    appendAnalysisRows(Array.isArray(payload.analyses) ? payload.analyses : [], appointmentDate);
}

document.addEventListener('DOMContentLoaded', () => {
    render(readPayload());
    document.getElementById('printButton').addEventListener('click', () => window.print());
    document.getElementById('closeButton').addEventListener('click', () => window.close());
});
