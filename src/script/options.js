"use strict";

hljs.initHighlightingOnLoad();

function showNote(noteId, allNotes, showNotesArea, noteIsShown) {
    if (!noteIsShown) showNotesArea.textContent = "";
    else if (Object.keys(allNotes).indexOf(noteId) != -1) {
        showNotesArea.textContent = allNotes[noteId].md;
    }
    document.querySelectorAll("pre code").forEach(block => {
        hljs.highlightBlock(block);
    });
}

//-------- modified from https://github.com/yunbow/sample-zlib-js/blob/master/02/02/js/index.js

function strToUtf8Array(strIn) {
    const strLength = strIn.length;
    let bytes = [];
    for (let i = 0; i < strLength; i++) {
        const c = strIn.charCodeAt(i);
        if (c <= 0x7F) {
            bytes.push(c);
        } else if (c <= 0x7FF) {
            bytes.push(0xC0 | (c >>> 6));
            bytes.push(0x80 | (c & 0x3F));
        } else if (c <= 0xFFFF) {
            bytes.push(0xE0 | (c >>> 12));
            bytes.push(0x80 | ((c >>> 6) & 0x3F));
            bytes.push(0x80 | (c & 0x3F));
        } else {
            bytes.push(0xF0 | (c >>> 18));
            bytes.push(0x80 | ((c >>> 12) & 0x3F));
            bytes.push(0x80 | ((c >>> 6) & 0x3F));
            bytes.push(0x80 | (c & 0x3F));
        }
    }
    return bytes;
}

(async function () {
    // init
    let noteIsShown = true;
    let allNotes = {};
    let selectedId = "";

    try {
        // 自動移行を実行（既存ユーザー向け）
        const migrationResult = await autoMigrate();
        if (migrationResult.needed && migrationResult.result) {
            console.log(`[HackMD Search] Migration completed: ${migrationResult.result.migrated} notes migrated.`);
        }

        // IndexedDBから全ノートを取得
        const notes = await hackmdStorage.getAllNotes();

        // 配列をマップに変換
        allNotes = {};
        notes.forEach(note => {
            allNotes[note.id] = note;
        });

        // set datalist
        const datalist = document.querySelector(".selectNote datalist");
        Object.entries(allNotes).sort((a,b)=>b[1].time-a[1].time).forEach(kv => {
            const option = document.createElement("option");
            option.value = kv[1].title + " ".repeat(5) + "id:" + kv[0];
            datalist.appendChild(option);
        });

        // ストレージサイズを表示
        const storageSize = await hackmdStorage.getStorageSize();
        const displayElement = document.querySelector(".displayAllNotesSize");
        if (displayElement) {
            displayElement.textContent = `${storageSize.kb} KB @ ${storageSize.count} notes`;
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
        const displayElement = document.querySelector(".displayAllNotesSize");
        if (displayElement) {
            displayElement.textContent = 'Error loading notes';
        }
    }

    document.querySelectorAll(".selectSortKey").forEach(selectElement => {
        Object.entries({"time: latest":"time +1","time: oldest":"time -1","title: AtoZ":"title +1", "title: ZtoA":"title -1"}).forEach(kv => {
            const option = document.createElement("option");
            option.value = kv[1];
            option.textContent = kv[0];
            selectElement.appendChild(option);
        });
    });

    document.addEventListener("click", function(e) {
        const target = e.target;
        const e_class = target.getAttribute("class");
        if (e_class && e_class.indexOf("selectSortKey") != -1) {
            const sortKey = target.value.split(" ")[0];
            const sortOrder = target.value.split(" ")[1] - 0;
            const datalist = document.querySelector(".selectNote datalist");
            datalist.innerHTML = "";
            Object.entries(allNotes).sort((a,b)=>{
                if (["time"].indexOf(sortKey)!=-1){
                    return sortOrder*(b[1][sortKey]-a[1][sortKey]);
                } else return (b[1][sortKey]>a[1][sortKey]) ? -1*sortOrder : sortOrder;
            }).forEach(kv => {
                const option = document.createElement("option");
                option.value = kv[1].title + " ".repeat(5) + "id:" + kv[0];
                datalist.appendChild(option);
            });
        }
    });

    // check note id
    const inputNoteTitle = document.querySelector(".inputNoteTitle");
    if (inputNoteTitle) {
        inputNoteTitle.addEventListener("change", function(e) {
            const selectedValue = e.target.value;
            if (/\s{5}id:\S+$/.test(selectedValue)) {
                // obtain note id
                selectedId = selectedValue.match(/(?<=\s{5}id:)\S+$/)[0];
                e.target.value = selectedValue.replace(/\s{5}id:\S+$/, "");
                const parentForm = e.target.closest("form");
                if (parentForm) {
                    const showNotesArea = parentForm.querySelector(".showNotesArea");
                    if (showNotesArea) {
                        showNote(selectedId, allNotes, showNotesArea, noteIsShown);
                    }
                }
            } else if (!selectedValue) selectedId = "";
        });
    }

    // toggle shown and hidden
    const btnShowHideNotes = document.querySelector(".btnShowHideNotes");
    if (btnShowHideNotes) {
        btnShowHideNotes.addEventListener("click", function(e) {
            noteIsShown = !noteIsShown;
            const newText = (noteIsShown ? "SHOW/hide" : "HIDE/show") + " a Note";
            e.target.textContent = newText;
            const parentForm = e.target.closest("form");
            if (parentForm) {
                const showNotesArea = parentForm.querySelector(".showNotesArea");
                if (showNotesArea) {
                    showNote(selectedId, allNotes, showNotesArea, noteIsShown);
                }
            }
        });
    }

    const btnClear = document.querySelector(".btnClear");
    if (btnClear) {
        btnClear.addEventListener("click", function(e) {
            const parentForm = e.target.closest("form");
            if (parentForm) {
                const input = parentForm.querySelector(".inputNoteTitle");
                if (input) input.value = "";
            }
        });
    }

    // copy to clipboard
    const btnCopyNotes = document.querySelector(".btnCopyNotes");
    if (btnCopyNotes) {
        btnCopyNotes.addEventListener("click", async function(e) {
            const parentForm = e.target.closest("form");
            if (parentForm) {
                const showNotesArea = parentForm.querySelector(".showNotesArea");
                if (showNotesArea) {
                    const noteContent = showNotesArea.textContent;
                    await navigator.clipboard.writeText(noteContent);
                }
            }
        });
    }

    // download as md
    const btnDownloadNotes = document.querySelector(".btnDownloadNotes");
    if (btnDownloadNotes) {
        btnDownloadNotes.addEventListener("click", async function(e) {
            // empty note id is invalid
            if (!selectedId) return;
            const parentForm = e.target.closest("form");
            if (!parentForm) return;
            const showNotesArea = parentForm.querySelector(".showNotesArea");
            if (!showNotesArea) return;
            const noteContent = showNotesArea.textContent;
            const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
            const blob = new Blob([bom, noteContent], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.download = allNotes[selectedId].title + ".md";
            a.href = url;
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    }

    // download all notes as zip
    const btnDownloadAllNotes = document.querySelector(".btnDownloadAllNotes");
    if (btnDownloadAllNotes) {
        btnDownloadAllNotes.addEventListener("click", async function(e) {
            // no stored notes
            if (allNotes == {}) return;

            const dirName = "hackMDsearch_AllNotes";
            const zip = new Zlib.Zip();
            Object.entries(allNotes).forEach(kv => {
                const noteId = kv[0];
                const note = kv[1];
                const plainData = note.md;
                zip.addFile(strToUtf8Array(plainData), {
                    filename: strToUtf8Array(`${dirName}/${note.title}__${noteId}.md`)
                });
            });
            const compressData = zip.compress();
            const blob = new Blob([compressData], { "type": "application/zip" });

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.download = `${dirName}.zip`;
            a.href = url;
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    }
})();
