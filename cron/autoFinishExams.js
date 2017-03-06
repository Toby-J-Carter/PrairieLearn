var ERR = require('async-stacktrace');
var _ = require('lodash');
var async = require('async');

var config = require('../lib/config');
var logger = require('../lib/logger');
var error = require('../lib/error');
var assessmentsExam = require('../assessments/exam');
var sqldb = require('../lib/sqldb');

module.exports = {};

module.exports.run = function(callback) {
    var params = [6 * 60];
    sqldb.call('assessment_instances_select_for_auto_close', params, function(err, result) {
        if (ERR(err, callback)) return;
        var examList = result.rows;

        async.eachSeries(examList, function(examItem, callback) {
            logger.verbose('autoFinishExams: finishing ' + examItem.assessment_instance_id, examItem);
            var auth_user_id = null; // graded by the system
            var finishExam = true; // close the exam after grading it
            assessmentsExam.gradeAssessmentInstance(examItem.assessment_instance_id, auth_user_id, examItem.credit, finishExam, function(err) {
                if (ERR(err, callback)) return;
                callback(null);
            });                
        }, function(err) {
            if (ERR(err, callback)) return;
            callback(null);
        });
    });
};
