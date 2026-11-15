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
  // The "Embed Project" button (nwl-components ProjectInfo.vue) shows an
  // iframe snippet framing /project/:p/embed, which opens the embed of the
  // project's first dataset (T002 3.7)
  showEmbedButton: true
};
