﻿"use strict";

// # onload
window.onload = async function () {
    addMenuButton();
    StoreToStorage();
    setInterval(StoreToStorage, 30000);

    chrome.storage.local.get({lastStoredDate:0 }, async (store_obj) => {
        if (Date.now() - store_obj.lastStoredDate > 30 * 86400 * 1000) {
            await StoreAllNotes();
        }
    })

    document.addEventListener("keydown", async function (e) {
        if (/select-one/.test($(e.target).attr("type")) && e.key == "Enter" && /\?nav=/.test(location.href)) {
            if (e.target.value == "?StoreAllNotes") {
                await StoreAllNotes();
                return;
            }
            await searchFromStorage(e.target.value);
        }
        if (/menu_sideHackMDsearch/.test($(e.target).attr("class"))) {
            $(".sidenav.main-sidenav").removeClass("in");
            $(".sidenav.sidenav-menu").removeClass("in");
        }
    })
    
    document.addEventListener("click", async function (e) {
        //console.log($(e.target).attr("class"))
        if (/menu_storeAllNotes/.test($(e.target).attr("class"))) {
            await StoreAllNotes();
        }
        /*if (/menu_downloadHTML/.test($(e.target).attr("class"))) {
            await downloadHTML();
        }*/
    })
    
}


function escape_html(str) {
    if (!str) return;
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

// # add button
function addMenuButton() {
    // menu heading
    const input_head = "全文検索";
    const menu_ul = $("ul .dropdown-menu.list[aria-label=メニュー]");
    const sep = $("<li>", { role: "presentation", "aria-hidden": "true", class: "divider", id: "sep_TOC" });
    const heading = $("<li>", { class: "dropdown-header" }).append(input_head);
    menu_ul.append(sep);
    menu_ul.append(heading);

    // side menu heading
    const menu_side_ul = $(".sidenav.sidenav-menu");
    const side_heading = $("<div>", { class: "divider-header" }).append(input_head);
    menu_side_ul.append(side_heading);

    const input_comps = [{ class: "menu_storeAllNotes", text: "Store All Notes" }];
    // const input_comps = [{ class: "menu_storeAllNotes", text: "Store All Notes" }, {class: "menu_downloadHTML", text:"Download HTML for PDF"}];

    for (const input_comp of input_comps) {
        // menu comp
        const comp = $("<li>", { role: "presentation" });
        const comp_a = $("<a>", { role: "menuitem", class: input_comp.class, href: "#", tabindex: "-1" });
        //const comp_i=$("<i>", {class:"fa fa-file-text fa-fw"});
        //comp_a.append(comp_i);
        comp_a.append(input_comp.text);
        comp.append(comp_a);
        menu_ul.append(comp);

        // side menu comp
        const side_comp = $("<a>", {
            class: `sidenav-item menu_sideHackMDsearch ${input_comp.class}`,
            tabindex: "-1", "data-toggle": "modal", "data-target": "#namedRevisionModal"
        });
        //const side_comp_i=$("<i>", {class:"fa fa-history fa-fw"});
        const side_span = $("<span>").append(input_comp.text);
        //side_comp.append(side_comp_i);
        side_comp.append(side_span);
        menu_side_ul.append(side_comp);
    }
}

// # store notes
async function StoreToStorage() {
    if (/\?nav=/.test(location.href)) return;
    //obtain from HackMD DOM
    const note_title = $("head > title").text().match(/^.*(?=\s-\sHackMD$)/)[0].replace(/\s|\//g, "_");
    const note_idTmp = location.href.match(/(?<=hackmd.io\/)[^\?#@]+/);
    if (!note_idTmp) return;
    const note_id=note_idTmp[0];
    //obtain note content with HackMD REST API
    const hackmd_url = "https://hackmd.io";
    const note_md = await fetch(`${hackmd_url}/${note_id}/download`).then(d => d.text());
    // 保存した日付もつけるかはそのうち考える -> つける
    chrome.storage.local.get({ store: {} }, async (store_obj) => {
        store_obj["store"][note_id] = { id:note_id, md: note_md, title: note_title, time:Date.now() };
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
        const id_tmp=id_tmpTmp[0];
        if (idAndNotes.map(d => d.id).indexOf(id_tmp) != -1 || /^@|\//.test(id_tmp)) continue;
        idAndNotes.push({
            id: id_tmp,
            title: history.text,
            md: await fetch(`${hackmd_url}/${id_tmp}/download`).then(d => d.text()),
            time: history.time
        });
    };
    //console.log(idAndNotes);
    chrome.storage.local.clear();
    chrome.storage.local.get({ store: {}, lastStoredDate:0 }, async (store_obj) => {
        for (const idAndNote of idAndNotes) {
            store_obj["store"][idAndNote.id] = { md: idAndNote.md, title: idAndNote.title, time:idAndNote.time, id:idAndNote.id };
        }
        await chrome.storage.local.set({ store: store_obj["store"], lastStoredDate:Date.now() });
        //console.log(store_obj["store"]);
    })
    console.log("Backup of All Notes Finished");
}

// # search
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
        .then(d => d["history"].reduce((acc,cur)=>Object.assign(acc, {[cur.id]:cur.time}) , {}) )
        //const sort_rule = "latest";
        const result_ids = Object.keys(queries).reduce((acc, key) => {
            return acc.filter(id => queries[key].every(q => {
                if (key == "plus") return result["store"][id].md.indexOf(q) != -1;
                if (key == "minus") return result["store"][id].md.indexOf(q) == -1;
                if (key == "reg") return new RegExp(q).test(result["store"][id].md);
            }))
        }, Object.keys(result["store"])).sort((a,b)=>-(hackmd_idTime[a]-hackmd_idTime[b]) );
        await showSearchResult(result_ids, { "plus": queries.plus, "reg": queries.reg });
    });
}

// ### show search result
async function showSearchResult(result_ids, queries) {
    const height = 130 + 117 * 2 * (Math.floor(result_ids.length / 2) + 1);
    const height_limited = height > $(window).height() ? $(window).height() : height;
    const constant_part = {
        head: `<div aria-label="grid" aria-readonly="true" class="ReactVirtualized__Grid ReactVirtualized__List TOCsearchResultArea"
        role="grid" tabindex="0" style="box-sizing: border-box; direction: ltr;
        height: ${height_limited}px; position: relative; width: 100%; will-change: transform; overflow-y: auto;">
            <div class="ReactVirtualized__Grid__innerScrollContainer TOCsearchResultArea" role="rowgroup"
             style="width: 100%; max-width: 100%; height: ${height_limited}px; overflow-y: auto; overflow-x:hidden; position: relative;">
            <div style="height: ${height_limited}px; left: 0px; position: absolute; top: 0px; width: 100%;">
            <div class="list-section" style="padding-top: 5px; padding-bottom: 8px;">
            <h1><span>全文検索結果</span></h1>`,
        ul: `<ul class="list inline-flex hmd-flex-row hmd-flex-wrap justify-content-start hmd-list-style-none hmd-pl-0 hmd-w-100"
        id="list_ul_searchResult">`,
        foot: `</ul></div></div></div>`
    };

    const first_search = $("#list_ul_searchResult").length > 0 ? false : true;
    if (!first_search) $("#list_ul_searchResult").empty();

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
                        acc.concat(note_md.match(new RegExp(`(.|\n){0,20}${q}(.|\n){0,20}`, "gi"))
                            .map(d => q_key == "reg" ? escape_html(d).replace(new RegExp(`(${q})`, "gi"), `<span style="color: orange;">$1</span>`)
                                : escape_html(d).split(escape_html(q)).join(`<span style="color: orange;">${escape_html(q)}</span>`))), [])
                    ), []).join("......") || note_md.slice(0, 100);
                const result_part = `<li class="col-xs-12 col-sm-6 col-md-6 col-lg-4 hmd-list-style-none">
                        <div class="overview-card-container" style="height: 234px; overflow:hidden;">
                        <a class="card-anchor" href="${note_url}"></a>
                        <div class="item" style="height: 220px; overflow:hidden;">
                        <div class="content hmd-text-left hmd-pt-1 hmd-pr-3/2 hmd-pl-3" style="max-height: 220px; overflow:hidden;">
                        <a href="${note_url}">
                        <h4 class="hmd-ml-0 hmd-mt-0 hmd-mb-1/2 text hmd-flex hmd-items-end" title="${note_title}">
                    <span class="title">${note_title}</span></h4></a>
                        <a href="${note_url}">${searched_parts}</a></div>`
                result_html += result_part;
            } catch (e) { console.log(note_id, e); };
        }
        result_html += !first_search ? "" : constant_part.foot;
        if (first_search) {
            const ov = $(".overview-component");
            const marker = $("div:eq(0)", ov);
            marker.after(result_html);
        } else {
            const marker = $("#list_ul_searchResult");
            marker.append(result_html);
        }

    });
    $(".TOCsearchResultArea::-webkit-scrollbar").css({ "display": "none" });
}

// # not used
async function downloadHTML(){
    const html=$("<html>", {lang:"ja"});
    const head=$("head").clone();
    const body=$("<body>", {style:"background-color: white; padding-top: 51px;"});
    const row=$("<div>", {class:"row-ui-content"})
    const area=$("<div>", {class:"ui-view-area"})
    const doc=$("#doc").clone();
    const scripts=$("div.ui-content ~ *").clone()
    area.append(doc);
    body.append(row.append(area));
    scripts.map((ind, obj)=>body.append($(obj).prop("outerHTML")+"\n"));
    html.append(head.prop("outerHTML")+"\n"+body.prop("outerHTML"));
    const content=html.prop("outerHTML");

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

