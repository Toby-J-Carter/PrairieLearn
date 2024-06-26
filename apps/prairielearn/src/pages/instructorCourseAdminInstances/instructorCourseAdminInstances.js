// @ts-check
const ERR = require('async-stacktrace');
const asyncHandler = require('express-async-handler');
import * as express from 'express';
import * as fs from 'fs-extra';
import * as async from 'async';
const _ = require('lodash');
import * as path from 'path';
import * as sqldb from '@prairielearn/postgres';
const debug = require('debug')('prairielearn:' + path.basename(__filename, '.js'));
import * as error from '@prairielearn/error';

import { CourseInstanceAddEditor } from '../../lib/editors';
import { idsEqual } from '../../lib/id';
import { selectCourseInstancesWithStaffAccess } from '../../models/course-instances';

var router = express.Router();
var sql = sqldb.loadSqlEquiv(__filename);

router.get('/', function (req, res, next) {
  async.series(
    [
      (callback) => {
        fs.access(res.locals.course.path, (err) => {
          if (err) {
            if (err.code === 'ENOENT') {
              res.locals.needToSync = true;
            } else {
              return ERR(err, callback);
            }
          }
          callback(null);
        });
      },
      async () => {
        res.locals.course_instances = await selectCourseInstancesWithStaffAccess({
          course_id: res.locals.course.id,
          user_id: res.locals.user.user_id,
          authn_user_id: res.locals.authn_user.user_id,
          is_administrator: res.locals.is_administrator,
          authn_is_administrator: res.locals.authz_data.authn_is_administrator,
        });
      },
      (callback) => {
        const params = {
          course_id: res.locals.course.id,
        };
        sqldb.query(sql.select_enrollment_counts, params, (err, result) => {
          if (ERR(err, callback)) return;
          res.locals.course_instances.forEach((ci) => {
            var row = _.find(result.rows, (row) => idsEqual(row.course_instance_id, ci.id));
            ci.number = row?.number || 0;
          });
          callback(null);
        });
      },
    ],
    (err) => {
      if (ERR(err, next)) return;
      res.render(__filename.replace(/\.js$/, '.ejs'), res.locals);
    },
  );
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    debug(`Responding to post with action ${req.body.__action}`);
    if (req.body.__action === 'add_course_instance') {
      debug(`Responding to action add_course_instance`);
      const editor = new CourseInstanceAddEditor({
        locals: res.locals,
      });
      const serverJob = await editor.prepareServerJob();
      try {
        await editor.executeWithServerJob(serverJob);
      } catch (err) {
        res.redirect(res.locals.urlPrefix + '/edit_error/' + serverJob.jobSequenceId);
        return;
      }

      debug(
        `Get course_instance_id from uuid=${editor.uuid} with course_id=${res.locals.course.id}`,
      );
      const result = await sqldb.queryOneRowAsync(sql.select_course_instance_id_from_uuid, {
        uuid: editor.uuid,
        course_id: res.locals.course.id,
      });
      res.redirect(
        res.locals.plainUrlPrefix +
          '/course_instance/' +
          result.rows[0].course_instance_id +
          '/instructor/instance_admin/settings',
      );
    } else {
      throw new error.HttpStatusError(400, `unknown __action: ${req.body.__action}`);
    }
  }),
);

export default router;
