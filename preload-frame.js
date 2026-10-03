const { ipcRenderer } = require('electron');

const sourceId = `source_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let selectedTables = [];

const GROUP_COLORS = {
    '1': '#3498db', '2': '#9b59b6', '3': '#e67e22', '4': '#1abc9c', '5': '#e74c3c'
};

// 💡 메인 창(index.js)으로 현재 표 목록을 즉시 밀어넣는(Push) 함수
function syncToMain() {
    ipcRenderer.sendToHost('table-selection-updated', {
        sourceId,
        tables: selectedTables
    });
}

function enhanceTables(root = document) {
    const tables = root.matches?.('table') ? [root] : root.querySelectorAll?.('table') || [];

    tables.forEach((table, index) => {
        if (table.dataset.dartPickerReady === 'true') return;
        table.dataset.dartPickerReady = 'true';
        table.style.transition = 'outline 0.15s ease';
        table.style.position = 'relative'; 
        table.dataset.selected = 'false';
        
        const uniqueId = `${sourceId}_table_${index}_${Math.random().toString(36).slice(2)}`;

        table.addEventListener('mouseenter', () => {
            if (table.dataset.selected !== 'true') {
                table.style.outline = '3px solid #ff4d4d';
                table.style.cursor = 'pointer';
            }
        });

        table.addEventListener('mouseleave', () => {
            if (table.dataset.selected !== 'true') {
                table.style.outline = 'none';
            }
        });

        table.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (table.dataset.selected === 'false') {
                table.dataset.selected = 'true';
                table.style.outline = '4px solid #2ecc71';

                const groupInput = document.createElement('input');
                groupInput.type = 'number';
                groupInput.placeholder = '#';
                groupInput.id = `badge_${uniqueId}`;
                groupInput.style.cssText = `
                    position: absolute; top: -15px; right: -15px;
                    width: 40px; height: 26px; border-radius: 13px;
                    border: 2px solid white; background-color: #95a5a6; color: white;
                    font-weight: bold; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                    z-index: 9999; outline: none;
                `;

                groupInput.addEventListener('click', (ev) => ev.stopPropagation());

                groupInput.addEventListener('input', (event) => {
                    const groupNum = event.target.value;
                    groupInput.style.backgroundColor = GROUP_COLORS[groupNum] || '#95a5a6';
                    
                    const targetIdx = selectedTables.findIndex(t => t.id === uniqueId);
                    if (targetIdx > -1) {
                        selectedTables[targetIdx].groupNo = groupNum;
                        syncToMain(); // 💡 입력값이 바뀔 때마다 동기화
                    }
                });

                table.appendChild(groupInput);
                groupInput.focus();

                selectedTables.push({
                    id: uniqueId,
                    groupNo: '',
                    outerHTML: table.cloneNode(true).outerHTML
                });

                syncToMain(); // 💡 표가 선택될 때 동기화

            } else {
                table.dataset.selected = 'false';
                table.style.outline = 'none';
                const badge = document.getElementById(`badge_${uniqueId}`);
                if (badge) badge.remove();
                
                selectedTables = selectedTables.filter(t => t.id !== uniqueId);
                syncToMain(); // 💡 표 선택이 해제될 때 동기화
            }
        });
    });
}

window.addEventListener('DOMContentLoaded', () => {
    enhanceTables(document);

    // DART가 뒤늦게 삽입하는 표도 같은 방식으로 선택할 수 있게 한다.
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) enhanceTables(node);
        }));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
});
