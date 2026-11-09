const _ = require('lodash');
const { AccessControlService } = require('neuroweblab');
const { isAnyone } = require('./project.validation');

/**
 * A project as a visitor may see it: the collaborators other than 'anyone'
 * and the annotations list are hidden unless the visitor may view them. Used
 * by GET /project/json/:name, the project page (GET /project/:name) and the
 * user's projects (M1, M3). `modifiedBy` is hidden with the collaborators.
 * The visitor must already be allowed to view the files. A missing list is
 * shown as an empty one.
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
  // Both decided on the unchanged project (2026-11-09): hiding the
  // collaborators first removed the visitor's own entry, so a collaborator who
  // may view the annotations but not the collaborators was judged as 'anyone'.
  const show = {
    collaborators: AccessControlService.canViewCollaborators(project, loggedUser),
    annotations: AccessControlService.canViewAnnotations(project, loggedUser)
  };
  if (!show.collaborators) {
    project.collaborators.list = project.collaborators.list.filter((c) => _.isPlainObject(c) && isAnyone(c));
    // who saved last may be a collaborator
    delete project.modifiedBy;
  }
  if (!show.annotations) {
    project.annotations.list = [];
  }

  return project;
};

module.exports = { visibleProjectParts };
