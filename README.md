# HackMDsearch

## Abstract

With this extension, you can search from sentences of your notes in HackMD.
**To reduce the burden of HackMD server, this extension stores your all notes in Chrome extension cache.**

## Usage

### Store All Notes
On initial use, you should store your all notes to this extension cache. There are two methods.
- Push `Stote All Notes` in the navi menu
- input `?StoreAllNotes` in the search input field and press Enter,

When you open a note in HackMD, this extension updated the note content in the cache regularly.

### Search
Input words in the search input field and press Enter, then the results with the search words highlighted will be shown.

You can utilize some methods and combine them.

|method|input|effect|
|-|-|-|
|default|`words`|splited with space and find notes with all queries|
|minus|-`word`|exclude notes with _minus words_ from the results|
|phrase|"`words`"|words surrounded `"` are not splited even they include spaces|
|RegEx|reg:`regular expression`|you can use regular expression|

## Caution
Again **to reduce the burden of HackMD server, this extension stores your all notes in Chrome extension cache.**
The cache storage may be `10-100 kBytes per note`.

## LICENSE

MIT
