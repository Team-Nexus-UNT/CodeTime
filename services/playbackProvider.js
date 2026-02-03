const vscode = require('vscode');

class PlaybackProvider {
    constructor(){
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
        this._docs = new Map();
    }

    provideTextDocumentContent(uri) {
        return this._docs.get(uri.toString()) ?? '';
    }
    
    setContent(uri, content) {
        this._docs.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }
}

module.exports = { PlaybackProvider };