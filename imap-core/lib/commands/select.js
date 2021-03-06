'use strict';

let imapHandler = require('../handler/imap-handler');
let imapTools = require('../imap-tools');

// tag SELECT "mailbox"
// tag EXAMINE "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [{
        name: 'mailbox',
        type: 'string'
    }, {
        name: 'extensions',
        type: 'array',
        optional: true
    }],

    handler(command, callback) {

        let mailbox = imapTools.normalizeMailbox(command.attributes[0] && command.attributes[0].value || '');

        let extensions = [].
        concat(command.attributes[1] || []).
        map(attr => (attr && attr.value || '').toString().toUpperCase());

        // Is CONDSTORE found from the optional arguments list?
        if (extensions.indexOf('CONDSTORE') >= 0) {
            this.condstoreEnabled = true;
        }

        if (typeof this._server.onOpen !== 'function') {
            return callback(null, {
                response: 'NO',
                message: command.command + ' not implemented'
            });
        }

        if (!mailbox) {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'NONEXISTENT'
            });
        }

        this._server.onOpen(mailbox, this.session, (err, folder) => {
            if (err) {
                this.session.selected = this.selected = false;
                this.state = 'Authenticated';
                return callback(err);
            }

            if (!folder || typeof folder === 'string') {
                this.session.selected = this.selected = false;
                this.state = 'Authenticated';
                return callback(null, {
                    response: 'NO',
                    code: typeof folder === 'string' ? folder : 'NONEXISTENT'
                });
            }

            // Set current state as selected
            this.session.selected = this.selected = {
                modifyIndex: folder.modifyIndex,
                uidList: folder.uidList,
                notifications: [],
                condstoreEnabled: this.condstoreEnabled,
                readOnly: (command.command || '').toString().toUpperCase() === 'EXAMINE' ? true : false,
                mailbox
            };
            this.state = 'Selected';

            // * FLAGS (\Answered \Flagged \Draft \Deleted \Seen)
            this.send(imapHandler.compiler({
                tag: '*',
                command: 'FLAGS',
                attributes: [
                    [{
                        type: 'atom',
                        value: '\\Answered'
                    }, {
                        type: 'atom',
                        value: '\\Flagged'
                    }, {
                        type: 'atom',
                        value: '\\Draft'
                    }, {
                        type: 'atom',
                        value: '\\Deleted'
                    }, {
                        type: 'atom',
                        value: '\\Seen'
                    }]
                ]
            }));

            // * OK [PERMANENTFLAGS (\Answered \Flagged \Draft \Deleted \Seen \*)] Flags permitted
            this.send(imapHandler.compiler({
                tag: '*',
                command: 'OK',
                attributes: [{
                    type: 'section',
                    section: [
                        // unrelated comment to enforce eslint-happy indentation
                        {
                            type: 'atom',
                            value: 'PERMANENTFLAGS'
                        },
                        [{
                            type: 'atom',
                            value: '\\Answered'
                        }, {
                            type: 'atom',
                            value: '\\Flagged'
                        }, {
                            type: 'atom',
                            value: '\\Draft'
                        }, {
                            type: 'atom',
                            value: '\\Deleted'
                        }, {
                            type: 'atom',
                            value: '\\Seen'
                        }, {
                            type: 'text',
                            value: '\\*'
                        }]
                    ]
                }, {
                    type: 'text',
                    value: 'Flags permitted'
                }]
            }));

            // * OK [UIDVALIDITY 123] UIDs valid
            this.send(imapHandler.compiler({
                tag: '*',
                command: 'OK',
                attributes: [{
                    type: 'section',
                    section: [{
                        type: 'atom',
                        value: 'UIDVALIDITY'
                    }, {
                        type: 'atom',
                        value: String(Number(folder.uidValidity) || 1)
                    }]
                }, {
                    type: 'text',
                    value: 'UIDs valid'
                }]
            }));

            // * 0 EXISTS
            this.send('* ' + folder.uidList.length + ' EXISTS');

            // * 0 RECENT
            this.send('* 0 RECENT');

            // * OK [HIGHESTMODSEQ 123]
            if ('modifyIndex' in folder && Number(folder.modifyIndex)) {
                this.send(imapHandler.compiler({
                    tag: '*',
                    command: 'OK',
                    attributes: [{
                        type: 'section',
                        section: [{
                            type: 'atom',
                            value: 'HIGHESTMODSEQ'
                        }, {
                            type: 'atom',
                            value: String(Number(folder.modifyIndex) || 0)
                        }]
                    }, {
                        type: 'text',
                        value: 'Highest'
                    }]
                }));
            }

            // * OK [UIDNEXT 1] Predicted next UID
            this.send(imapHandler.compiler({
                tag: '*',
                command: 'OK',
                attributes: [{
                    type: 'section',
                    section: [{
                        type: 'atom',
                        value: 'UIDNEXT'
                    }, {
                        type: 'atom',
                        value: String(Number(folder.uidNext) || 1)
                    }]
                }, {
                    type: 'text',
                    value: 'Predicted next UID'
                }]
            }));

            // start listening for EXPUNGE, EXISTS and FETCH FLAGS notifications
            this.updateNotificationListener(() => {
                callback(null, {
                    response: 'OK',
                    code: this.selected.readOnly ? 'READ-ONLY' : 'READ-WRITE',
                    message: command.command + ' completed' + (this.selected.condstoreEnabled ? ', CONDSTORE is now enabled' : '')
                });
            });

        });
    }
};
