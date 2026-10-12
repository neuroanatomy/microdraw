const _ = require('lodash');
const { AccessControlService } = require('neuroweblab');
const { isAnyone } = require('./project.validation');

/**
 * A project as a visitor may see it: the collaborators other than 'anyone'
 * and the annotations list are hidden unless the visitor may view them. Used
 * by GET /project/json/:name, the project page (GET /project/:name) and the
 * user's projects (M1, M3). The visitor must already be allowed to view the
 * files. A missing list is shown as an empty one.
 * @param {object} project The project document (changed in place)
 * @param {string} loggedUser The visitor's username, or 'anyone'
 * @returns {object} The project
 */
const visibleProjectParts = (project, loggedUser) => {
  for (const type of ['collaborators', 'files', 'annotations']) {
    if (!_.isPlainObject(project[type]) || !Array.isArray(project[type].list)) {
      project[type] = { ...(_.isPlainObject(project[type]) ? project[type] : {}), list: [] };
    }
  }
  if (!AccessControlService.canViewCollaborators(project, loggedUser)) {
    project.collaborators.list = project.collaborators.list.filter((c) => _.isPlainObject(c) && isAnyone(c));
  }
  if (!AccessControlService.canViewAnnotations(project, loggedUser)) {
    project.annotations.list = [];
  }

  return project;
};

module.exports = { visibleProjectParts };
