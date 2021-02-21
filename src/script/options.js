
hljs.initHighlightingOnLoad();

function showNote(noteId, allNotes, showNotesArea, noteIsShown) {
    if (!noteIsShown) showNotesArea.text("");
    else if (Object.keys(allNotes).indexOf(noteId) != -1) {
        showNotesArea.text(allNotes[noteId].md);
    }
    $("pre code").each(function (i, block) {
        hljs.highlightBlock(block);
    });
}

//-------- modified from https://github.com/yunbow/sample-zlib-js/blob/master/02/02/js/index.js

function strToUtf8Array(strIn) {
    const strLength = strIn.length;
    const idx = -1;
    let bytes = [];
    for (const i = 0; i < strLength; i++) {
        const c = str.charCodeAt(i);
        if (c <= 0x7F) {
            bytes[++idx] = c;
        } else if (c <= 0x7FF) {
            bytes[++idx] = 0xC0 | (c >>> 6);
            bytes[++idx] = 0x80 | (c & 0x3F);
        } else if (c <= 0xFFFF) {
            bytes[++idx] = 0xE0 | (c >>> 12);
            bytes[++idx] = 0x80 | ((c >>> 6) & 0x3F);
            bytes[++idx] = 0x80 | (c & 0x3F);
        } else {
            bytes[++idx] = 0xF0 | (c >>> 18);
            bytes[++idx] = 0x80 | ((c >>> 12) & 0x3F);
            bytes[++idx] = 0x80 | ((c >>> 6) & 0x3F);
            bytes[++idx] = 0x80 | (c & 0x3F);
        }
    }
    return bytes;
};

$(async function () {
    // init
    let noteIsShown = true;
    let allNotes = {};
    let selectedId = "";
    chrome.storage.local.get({ "store": {} }, async (store_obj) => {
        allNotes = store_obj.store;
        // console.log(allNotes)
        // set datalist
        const datalist = $(".selectNote datalist");
        Object.entries(allNotes).sort((a,b)=>b[1].time-a[1].time).forEach(kv => {
            const option = $("<option>")
                .val(kv[1].title + " ".repeat(5) + "id:" + kv[0]);
            datalist.append(option);
        })
        const allNotesNum = Object.keys(allNotes).length;
        const allNotesSize = Object.values(allNotes)
            .reduce((acc, cur) => acc + (new Blob([cur.md])).size, 0);
        $(".displayAllNotesSize").html(`${Math.round(allNotesSize / 1024)} KB @ ${allNotesNum} notes`);
    });

    $(".selectSortKey").each((ind, obj)=>{
        Object.entries({"time: latest":"time +1","time: oldest":"time -1","title: AtoZ":"title +1", "title: ZtoA":"title -1"}).forEach(kv=>{
            const option=$("<option>").val(kv[1]).text(kv[0]);
            $(obj).append(option);
        })
    })

    document.addEventListener("click", function(e){
        const e_class=$(e.target).attr("class");
        if (e_class && e_class.indexOf("selectSortKey")!=-1){
            const sortKey=$(e.target).val().split(" ")[0];
            const sortOrder=$(e.target).val().split(" ")[1] - 0;
            //console.log(sortKey, sortOrder)
            const datalist = $(".selectNote datalist");
            datalist.empty();
            Object.entries(allNotes).sort((a,b)=>{
                if (["time"].indexOf(sortKey)!=-1){
                    return sortOrder*(b[1][sortKey]-a[1][sortKey]);
                } else return (b[1][sortKey]>a[1][sortKey]) ? -1*sortOrder : sortOrder;
            }).forEach(kv => {
                const option = $("<option>")
                    .val(kv[1].title + " ".repeat(5) + "id:" + kv[0]);
                datalist.append(option);
            })
        }
    })

    // check note id
    $(".inputNoteTitle").on("change", function (e) {
        const selectedValue = $(e.target).val();
        if (/\s{5}id:\S+$/.test(selectedValue)) {
            // obtain note id
            selectedId = selectedValue.match(/(?<=\s{5}id:)\S+$/)[0];
            $(e.target).val(selectedValue.replace(/\s{5}id:\S+$/, ""));
            const showNotesArea = $(".showNotesArea", e.target.parent);
            showNote(selectedId, allNotes, showNotesArea, noteIsShown);
        } else if (!selectedValue) selectedId = "";
    })
    //  toggle shown and hidden
    $(".btnShowHideNotes").on("click", function (e) {
        noteIsShown = !noteIsShown;
        const newText = (noteIsShown ? "SHOW/hide" : "HIDE/show") + " a Note";
        $(e.target).text(newText);
        const showNotesArea = $(".showNotesArea", e.target.parent);
        showNote(selectedId, allNotes, showNotesArea, noteIsShown);
    })
    $(".btnClear").on("click", function (e) {
        $(".inputNoteTitle", e.target.parent).val("");
    })
    // copy to clipboard
    $(".btnCopyNotes").on("click", async function (e) {
        const showNotesArea = $(".showNotesArea", e.target.parent);
        const noteContent = showNotesArea.text();
        await navigator.clipboard.writeText(noteContent);
    })
    // download as md
    $(".btnDownloadNotes").on("click", async function (e) {
        // empty note id is invalid
        if (!selectedId) return;
        const showNotesArea = $(".showNotesArea", e.target.parent);
        const noteContent = showNotesArea.text();
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, noteContent], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.download = allNotes[selectedId].title + ".md";
        a.href = url;
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    })
    // download all notes as zip
    $(".btnDownloadAllNotes").on("click", async function (e) {
        // no stored notes
        if (allNotes == {}) return;

        const dirName = "hackMDsearch_AllNotes"
        const zip = new Zlib.Zip();
        Object.entries(allNotes).slice(10).forEach(kv => {
            const noteId = kv[0];
            const note = kv[1];
            const plainData = note.md;
            zip.addFile(strToUtf8Array(plainData), {
                filename: strToUtf8Array(`${dirName}/${note.title}__${noteId}.md`)
            });
        })
        const compressData = zip.compress();
        const blob = new Blob([compressData], { "type": "application/zip" });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.download = `${dirName}.zip`;
        a.href = url;
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    })
})

