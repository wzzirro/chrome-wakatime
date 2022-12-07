/* global browser */
//jshint esnext:true

var $ = require('jquery');
var matchUrl = require('match-url-wildcard');
var moment = require('moment');
var config = require('./../config');

// Helpers
var getDomainFromUrl = require('./../helpers/getDomainFromUrl');
var changeExtensionState = require('../helpers/changeExtensionState');
var in_array = require('./../helpers/in_array');
var contains = require('./../helpers/contains');

class WakaTimeCore {

    constructor() {
        this.tabsWithDevtoolsOpen = [];
    }

    /**
     * Settter for tabsWithDevtoolsOpen
     *
     * @param tabs
     */
    setTabsWithDevtoolsOpen(tabs) {
        this.tabsWithDevtoolsOpen = tabs;
    }

    getTotalTimeLoggedToday() {
        var deferredObject = $.Deferred();
        var today = moment().format('YYYY-MM-DD');

        $.ajax({
            url: config.summariesApiUrl + '?start=' + today + '&end=' + today,
            dataType: 'json',
            success: (data) => {

                deferredObject.resolve(data.data[0].grand_total);

            },
            error: (xhr, status, err) => {

                console.error(config.summariesApiUrl, status, err.toString());

                deferredObject.resolve(false);
            }
        });

        return deferredObject.promise();
    }

    /**
     * Checks if the user is logged in.
     *
     * @returns {*}
     */
    checkAuth() {
        var deferredObject = $.Deferred();

        $.ajax({
            url: config.currentUserApiUrl,
            dataType: 'json',
            success: (data) => {
                deferredObject.resolve(data.data);
            },
            error: (xhr, status, err) => {
                console.error(config.currentUserApiUrl, status, err.toString());
                deferredObject.resolve(false);
            }
        });

        return deferredObject.promise();
    }

    /**
     * Depending on various factors detects the current active tab URL or domain,
     * and sends it to WakaTime for logging.
     */
    recordHeartbeat() {
        browser.storage.sync.get({
            loggingEnabled: config.loggingEnabled,
            loggingStyle: config.loggingStyle,
            blacklist: '',
            whitelist: ''
        }).then((items) => {
            if (items.loggingEnabled === true) {
                changeExtensionState('allGood');

                browser.idle.queryState(config.detectionIntervalInSeconds).then((newState) => {
                    if (newState === 'active') {
                        // Get current tab URL.
                        browser.tabs.query({currentWindow: true, active: true}).then((tabs) => {
                            if (tabs.length == 0) return;

                            var currentActiveTab = tabs[0];
                            var debug = false;

                            // If the current active tab has devtools open
                            if (in_array(currentActiveTab.id, this.tabsWithDevtoolsOpen)) {
                                debug = true;
                            }

                            if (items.loggingStyle == 'blacklist') {
                                if (!contains(currentActiveTab.url, items.blacklist)) {
                                    this.sendHeartbeat({
                                        url: currentActiveTab.url,
                                        project: null,
                                    }, debug);
                                } else {
                                    changeExtensionState('blacklisted');
                                    console.log(currentActiveTab.url + ' is on a blacklist.');
                                }
                            }

                            if (items.loggingStyle == 'whitelist') {
                                var heartbeat = this.getHeartbeat(currentActiveTab.url, items.whitelist);
                                console.log(heartbeat.url);
                                if (heartbeat.url) {
                                    this.sendHeartbeat(heartbeat, debug);
                                } else {
                                    changeExtensionState('whitelisted');
                                    console.log(currentActiveTab.url + ' is not on a whitelist.');
                                }
                            }

                        });
                    }
                });
            } else {
                changeExtensionState('notLogging');
            }
        });
    }

    /**
     * Creates an array from list using \n as delimiter
     * and checks if any element in list is contained in the url.
     * Also checks if element is assigned to a project using @@ as delimiter
     *
     * @param url
     * @param list
     * @returns {object}
     */
    getHeartbeat(url, list) {
        var lines = list.split('\n');

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var cleanLine = line.trim();

            if (cleanLine !== '') {
                var rule = cleanLine.split('@@');
                var ruleUrl = rule[0]
                var ruleProject = rule[1]

                if (matchUrl(url, ruleUrl)) {
                    if (ruleProject) {
                        return {
                            url: url,
                            project: ruleProject
                        };
                    } else {
                        return {
                            url: ruleUrl,
                            project: null,
                        };
                    }
                }
            }
        }

        return {
            url: null,
            project: null,
        };
    }

    /**
     * Creates payload for the heartbeat and returns it as JSON.
     *
     * @param heartbeat
     * @param type
     * @param debug
     * @returns {*}
     * @private
     */
    _preparePayload(heartbeat, type, debug = false) {
        return JSON.stringify({
            entity: heartbeat.url,
            type: type,
            time: moment().format('X'),
            project: heartbeat.project || '<<LAST_PROJECT>>',
            is_debugging: debug,
            plugin: 'browser-wakatime/' + config.version
        });
    }

    /**
     * Given the heartbeat and logging type it creates a payload and
     * sends an ajax post request to the API.
     *
     * @param heartbeat
     * @param debug
     */
    sendHeartbeat(heartbeat, debug) {
        var payload = null;

        heartbeat.url = getDomainFromUrl(heartbeat.url);
        payload = this._preparePayload(heartbeat, 'domain', debug);
        console.log(payload);
        this.sendAjaxRequestToApi(payload);
    }

    /**
     * Sends AJAX request with payload to the heartbeat API as JSON.
     *
     * @param payload
     * @param method
     * @returns {*}
     */
    sendAjaxRequestToApi(payload, method = 'POST') {

        var deferredObject = $.Deferred();

        $.ajax({
            url: config.heartbeatApiUrl,
            dataType: 'json',
            contentType: 'application/json',
            method: method,
            data: payload,
            statusCode: {
                401: function () {
                    changeExtensionState('notSignedIn');
                },
                201: function () {
                    // nothing to do here
                }
            },
            success: (response) => {
                deferredObject.resolve(this);
            },
            error: (xhr, status, err) => {
                console.error(config.heartbeatApiUrl, status, err.toString());

                deferredObject.resolve(this);
            }
        });

        return deferredObject.promise();
    }

}

export default WakaTimeCore;
