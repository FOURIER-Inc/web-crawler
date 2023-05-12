import {JSDOM} from 'jsdom';
import 'node:url';
import { stringify } from "csv-stringify/sync";
import fs from 'node:fs';
import path from 'node:path';

const searchedUrls = new Map();

const rootUrl = process.argv[2];
// same-origin, same-host, same-domain, any
const range = 'same-origin';
const maxDepth = 3;

let maxRealDepth = 0;

function removeSubDomain(hostname) {
    const split = hostname.split('.');
    if (split.length <= 2) return hostname;
    return split.slice(1).join('.');
}

function isInnerOfSearchRange(url) {
    switch (range) {
        case 'same-origin':
            return url.origin === new URL(rootUrl).origin;
        case 'same-host':
            return url.host === new URL(rootUrl).hostname;
        case 'same-domain':
            return removeSubDomain(url.hostname) === removeSubDomain(new URL(rootUrl).hostname);
        case 'any':
        default:
            return true;
    }
}

function isPage(url) {
    return url.pathname.match(/^(?!.*(apng|avif|gif|jpg|jpeg|png|svg|webp|mp3|mp4|bmp|ico|tiff|docx|pdf|txt)).*$/g);
}

function collectData(url, dom) {
    let obj = new URL(url);
    let paths = obj.pathname.split('/').filter(p => p !== '');

    return {
        url: url,
        paths: paths,
        title: dom.window.document.title,
    };
}

function convertToRowData(dataset) {
    let realMaxDepth = 0;
    dataset.forEach(d => {
        if (d.paths.length > realMaxDepth) realMaxDepth = d.paths.length;
    });

    return dataset.map(d => {
        return {
            url: d.url,
            ...[...Array(realMaxDepth).keys()]
                .reduce((a, p) => {
                    return {...a, [`path${p}`]: d.paths[p] ?? ''}
                }, {}),
            title: d.title,
        };
    })
}

async function search(fetchUrl) {
    console.log(`searching: ${fetchUrl}`);
    const response = await fetch(fetchUrl);
    const dom = new JSDOM(await response.text());
    searchedUrls.set(fetchUrl, collectData(fetchUrl, dom));

    const nodeList = [...dom.window.document.querySelectorAll('a')];

    const newUrls = nodeList
        .map(link => {
            if (typeof link.href === 'undefined') return;
            try {
                return new URL(link.href);
            } catch (e) {
                try {
                    if (fetchUrl.endsWith(link.href)) {
                        return;
                    }

                    return new URL(link.href, fetchUrl);
                } catch (e) {
                }
            }
        })
        .filter(url => url !== undefined && (url.protocol === 'https:' || url.protocol === 'http:'));

    for (const url of newUrls) {
        if (searchedUrls.has(url.href) || !isInnerOfSearchRange(url) || !isPage(url)) continue;

        await search(url.href);
    }
}

await search(rootUrl);

let outputCSV = stringify(convertToRowData(Array.from(searchedUrls, d => d[1])), {header: true});

fs.writeFileSync('output.csv', outputCSV);

console.log(searchedUrls.size);
console.log('finished');
