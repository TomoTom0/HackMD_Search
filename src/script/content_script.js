"use strict";

// Helper functions to replace jQuery
function hasClass(element, className) {
    return element.classList && element.classList.contains(className);
}
function closest(element, selector) {
    while (element && element.nodeType === 1) {
        if (element.matches(selector)) return element;
        element = element.parentElement;
    }
    return null;
}

const operateStorage = (key = null, storageKey = "sync", operate = "get") => new Promise(resolve => {
    chrome.storage[storageKey][operate](key, resolve);
});

window.onload = async function () {
    addMenuButton();
    StoreToStorage();
    setInterval(StoreToStorage, 30000);

    chrome.storage.local.get({ lastStoredDate: 0 }, async (store_obj) => {
        if (Date.now() - store_obj.lastStoredDate > 30 * 86400 * 1000) {
            await StoreAllNotes();
        }
    });

    document.addEventListener("keydown", async function (e) {
        const sps_par = new URLSearchParams(location.search);
        if (hasClass(e.target, "ui-overview-sidebar-search-input") && e.key == "Enter" && sps_par.has("nav") && sps_par.has("q")) {
            const q_val = sps_par.get("q");
            if (q_val == "?StoreAllNotes") {
                await StoreAllNotes();
                return;
            }
            await searchFromStorage(q_val);
        }
        if (hasClass(e.target, "menu_sideHackMDsearch")) {
            document.querySelectorAll(".sidenav.main-sidenav").forEach(el => el.classList.remove("in"));
            document.querySelectorAll(".sidenav.sidenav-menu").forEach(el => el.classList.remove("in"));
        }
    });
    document.addEventListener("click", async function (e) {
        if (hasClass(e.target, "menu_storeAllNotes")) {
            await StoreAllNotes();
        }
    });
};

function escape_html(str) {
    if (!str) return "";
    return str.replace(/[<>&"'`]/g, (match) => {
        const escape = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#x60;'
        };
        return escape[match];
    });
}

function addMenuButton() {
    const input_head = "全文検索";
    const menu_ul = document.querySelector("ul .dropdown-menu.list[aria-label=メニュー]");
    if (!menu_ul) return;
    const sep = document.createElement("li");
    sep.setAttribute("role", "presentation");
    sep.setAttribute("aria-hidden", "true");
    sep.className = "divider";
    sep.id = "sep_TOC";
    const heading = document.createElement("li");
    heading.className = "dropdown-header";
    heading.append(input_head);
    menu_ul.appendChild(sep);
    menu_ul.appendChild(heading);

    const menu_side_ul = document.querySelector(".sidenav.sidenav-menu");
    if (!menu_side_ul) return;
    const side_heading = document.createElement("div");
    side_heading.className = "divider-header";
    side_heading.append(input_head);
    menu_side_ul.appendChild(side_heading);

    const input_comps = [{ class: "menu_storeAllNotes", text: "Store All Notes" }];
    for (const input_comp of input_comps) {
        // menu comp
        const comp = document.createElement("li");
        comp.setAttribute("role", "presentation");
        const comp_a = document.createElement("a");
        comp_a.setAttribute("role", "menuitem");
        comp_a.className = input_comp.class;
        comp_a.href = "#";
        comp_a.tabIndex = -1;
        comp_a.append(input_comp.text);
        comp.appendChild(comp_a);
        menu_ul.appendChild(comp);

        // side menu comp
        const side_comp = document.createElement("a");
        side_comp.className = `sidenav-item menu_sideHackMDsearch ${input_comp.class}`;
        side_comp.tabIndex = -1;
        side_comp.setAttribute("data-toggle", "modal");
        side_comp.setAttribute("data-target", "#namedRevisionModal");
        const side_span = document.createElement("span");
        side_span.append(input_comp.text);
        side_comp.appendChild(side_span);
        menu_side_ul.appendChild(side_comp);
    }
}

async function StoreToStorage() {
    if (/\?nav=/.test(location.href)) return;
    const titleEl = document.querySelector("head > title");
    if (!titleEl) return;
    const titleText = titleEl.textContent.match(/^.*(?=\s-\sHackMD$)/);
    if (!titleText) return;
    const note_title = titleText[0].replace(/\s|\//g, "_");
    const note_idTmp = location.href.match(/(?<=hackmd.io\/)[^\?#@]+/);
    if (!note_idTmp) return;
    const note_id = note_idTmp[0];
    const hackmd_url = "https://hackmd.io";
    const note_md = await fetch(`${hackmd_url}/${note_id}/download`).then(d => d.text());
    chrome.storage.local.get({ store: {} }, async (store_obj) => {
        store_obj["store"][note_id] = { id: note_id, md: note_md, title: note_title, time: Date.now() };
        await chrome.storage.local.set({ store: store_obj["store"] });
    });
}

async function StoreAllNotes() {
    const hackmd_url = "https://hackmd.io";
    const hackmd_histories = await fetch(`${hackmd_url}/history`).then(d => d.json()).then(d => d["history"]);
    let idAndNotes = [];
    for (const history of hackmd_histories) {
        const orig_id = history.id;
        const id_tmpTmp = orig_id.match(/^[^\?@#]+(?=\??.*$)/);
        if (!id_tmpTmp) continue;
        const id_tmp = id_tmpTmp[0];
        if (idAndNotes.map(d => d.id).indexOf(id_tmp) != -1 || /^@|\//.test(id_tmp)) continue;
        idAndNotes.push({
            id: id_tmp,
            title: history.text,
            md: await fetch(`${hackmd_url}/${id_tmp}/download`).then(d => d.text()),
            time: history.time
        });
    }
    chrome.storage.local.clear();
    chrome.storage.local.get({ store: {}, lastStoredDate: 0 }, async (store_obj) => {
        for (const idAndNote of idAndNotes) {
            store_obj["store"][idAndNote.id] = { md: idAndNote.md, title: idAndNote.title, time: idAndNote.time, id: idAndNote.id };
        }
        await chrome.storage.local.set({ store: store_obj["store"], lastStoredDate: Date.now() });
    });
    console.log("Backup of All Notes Finished");
}

function searchQuerySplit(q) {
    const replace_obj = { "\\\\": "__BACKSLASH__", '\\"': "__WQ__" };
    const escaped_q = Object.keys(replace_obj).reduce((acc, key) => acc.split(key).join(replace_obj[key]), q);
    const escaped_q2 = escaped_q.replace(/\s+/g, " ").replace(/^"/g, ' "').split(' "').map((d, ind) => {
        if (ind % 2 == 0) return d;
        else return d.replace(/ /g, "__SPACE__").replace(/"$/, "");
    }).join("");
    return Object.keys(replace_obj).reduce((acc, key) => acc.split(replace_obj[key]).join(key), escaped_q2)
        .split(" ").map(d => d.replace(/__SPACE__/g, " "));
}

async function searchFromStorage(q_in = "") {
    const queries_tmp = searchQuerySplit(q_in);
    const queries = {
        minus: queries_tmp.filter(d => /^-/.test(d)).map(d => d.slice(1)),
        reg: queries_tmp.filter(d => /^reg:/.test(d)).map(d => d.slice(4)),
        plus: queries_tmp.filter(d => !/^-|^reg:/.test(d)).map(d => d.replace(/^\\(?=(-|reg:))/, ""))
    };
    chrome.storage.local.get({ "store": {} }, async (result) => {
        const hackmd_url = "https://hackmd.io";
        const hackmd_idTime = await fetch(`${hackmd_url}/history`).then(d => d.json())
            .then(d => d["history"].reduce((acc, cur) => Object.assign(acc, { [cur.id]: cur.time }), {}));
        const result_ids = Object.keys(queries).reduce((acc, key) => {
            return acc.filter(id => queries[key].every(q => {
                if (key == "plus") return result["store"][id].md.indexOf(q) != -1;
                if (key == "minus") return result["store"][id].md.indexOf(q) == -1;
                if (key == "reg") return new RegExp(q).test(result["store"][id].md);
            }));
        }, Object.keys(result["store"]))
            .sort((a, b) => -(hackmd_idTime[a] - hackmd_idTime[b]));
        await showSearchResult(result_ids, { "plus": queries.plus, "reg": queries.reg });
    });
}

async function showSearchResult(result_ids, queries) {
    const height = 130 + 117 * 2 * (Math.floor(result_ids.length / 2) + 1);
    const height_limited = height > window.innerHeight ? window.innerHeight : height;
    const constant_part = {
        head: `<div aria-label="grid" aria-readonly="true" class="ReactVirtualized__Grid ReactVirtualized__List TOCsearchResultArea"
        role="grid" tabindex="0" style="box-sizing: border-box; direction: ltr;
        height: ${height_limited}px; position: relative; width: 100%; will-change: transform; overflow-y: auto;">
            <div class="ReactVirtualized__Grid__innerScrollContainer TOCsearchResultArea" role="rowgroup"
             style="width: 100%; max-width: 100%; height: ${height_limited}px; overflow-y: auto; overflow-x:hidden; position: relative;">
            <div style="height: ${height_limited}px; left: 0px; position: absolute; top: 0px; width: 100%;">
            <div class="list-section" style="padding-top: 5px; padding-bottom: 8px;">
            <h3 text-h3 leading-h3 m-0 flex gap-[6px] px-1 py-[5px] text-left font-system font-bold text-text-default><span>全文検索結果</span></h3>` ,
        ul: `<ul class="list inline-flex hmd-flex-row hmd-flex-wrap justify-content-start hmd-list-style-none hmd-pl-0 hmd-w-100"
        id="list_ul_searchResult">`,
        foot: `</ul></div></div></div>`
    };

    const first_search = document.getElementById("list_ul_searchResult") ? false : true;
    if (!first_search) document.getElementById("list_ul_searchResult").innerHTML = "";

    let result_html = !first_search ? "" : constant_part.head + constant_part.ul;
    const hackmd_url = "https://hackmd.io";

    chrome.storage.local.get({ store: {} }, store_obj => {
        for (const note_id of result_ids) {
            try {
                const note_title = escape_html(store_obj["store"][note_id].title);
                const note_md = store_obj["store"][note_id].md;
                const note_url = `${hackmd_url}/${note_id.match(/^[^\?]+(?=\??.*$)/)[0]}`;
                const searched_parts = Object.keys(queries).reduce((parts_now, q_key) =>
                    parts_now.concat(queries[q_key].reduce((acc, q) =>
                        acc.concat((note_md.match(new RegExp(`(.|\n){0,20}${q}(.|\n){0,20}`, "gi")) || [])
                            .map(d => {
                                return q_key == "reg" ? escape_html(d).replace(new RegExp(`(${q})`, "gi"), `<span style="color: orange;">$1</span>`)
                                    : escape_html(d).split(escape_html(q)).join(`<span style="color: orange;">${escape_html(q)}</span>`);
                            })), [])
                    ), []).join("......") || note_md.slice(0, 100);
                const result_part = `<li class="col-xs-12 col-sm-6 col-md-6 col-lg-4 hmd-list-style-none">
                        <div class="bg-background-subtler mr-2.5 mb-2.5" style="height: 234px; overflow:hidden;">
                        <a class="card-anchor" href="${note_url}"></a>
                        <div class="item" style="height: 220px; overflow:hidden;">
                        <div class="content hmd-text-left hmd-pt-1 hmd-pr-3/2 hmd-pl-3" style="max-height: 220px; overflow:hidden;">
                        <a href="${note_url}" style="text-decoration-color: var(--hmd-tw-text-primary);">
                        <h4 class="hmd-ml-0 hmd-mt-0 hmd-mb-1/2 text hmd-flex hmd-items-end text-text-primary" title="${note_title}">
                    <span class="title">${note_title}</span></h4></a>
                        ${searched_parts}</div>`;
                result_html += result_part;
            } catch (e) { console.log(note_id, e); }
        }
        result_html += !first_search ? "" : constant_part.foot;
        if (first_search) {
            const ov = document.querySelector("section.bg-background-default");
            if (!ov) return;
            const marker = ov.lastElementChild;
            if (marker) marker.insertAdjacentHTML("beforebegin", result_html);
        } else {
            const marker = document.getElementById("list_ul_searchResult");
            if (marker) marker.insertAdjacentHTML("beforeend", result_html);
        }
    });
    // Hide scrollbar (not as easy as jQuery, but can be done with CSS)
    const style = document.createElement('style');
    style.innerHTML = `.TOCsearchResultArea::-webkit-scrollbar { display: none !important; }`;
    document.head.appendChild(style);
}

// Not used
async function downloadHTML() {
    const html = document.createElement("html");
    html.lang = "ja";
    const head = document.head.cloneNode(true);
    const body = document.createElement("body");
    body.style.backgroundColor = "white";
    body.style.paddingTop = "51px";
    const row = document.createElement("div");
    row.className = "row-ui-content";
    const area = document.createElement("div");
    area.className = "ui-view-area";
    const doc = document.querySelector("#doc");
    if (doc) area.appendChild(doc.cloneNode(true));
    body.appendChild(row.appendChild(area));
    // scripts
    document.querySelectorAll("div.ui-content ~ *").forEach(obj => body.appendChild(obj.cloneNode(true)));
    html.appendChild(head);
    html.appendChild(body);
    const content = html.outerHTML;
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = "markdown.html";
    a.href = url;
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
