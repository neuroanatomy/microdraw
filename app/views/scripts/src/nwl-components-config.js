export default {
  siteName: "Microdraw",
  baseURL: window.location.protocol + "//" + window.location.host,
  logoURL: "/img/microdraw-white.svg",
  githubURL: "https://github.com/neuroanatomy/microdraw",
  issuesURL: "https://github.com/neuroanatomy/microdraw/issues",
  docURL: "https://microdraw.pasteur.fr/doc/",
  userSearchURL: "/search/json/users?q=",
  // the label sets of app/public/labels/, as BrainBox's (T002 3.2)
  fetchLabelSets: async () => (await fetch('/api/getLabelsets')).json(),
  annotationTypes: ["text", "vectorial"],
  usernameField: 'username',
  // nwl-components >= 1.4.0: no "Embed Project" button (microdraw has no
  // /project/:p/embed route until T002 stage 3.7)
  showEmbedButton: false
};
