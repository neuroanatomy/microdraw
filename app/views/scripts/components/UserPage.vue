<template>
    <UserPage :user="user">
      <template v-slot:side> {{projects.length}} Projects </template>
      <template v-slot:content>
        <Tabs>
          <Tab title="Projects">
            <Table id="projects">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Files</th>
                  <th>Collaborators</th>
                  <th>Owner</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="project in projects" :key="project.shortname">
                  <td>
                    <a :href="`/project/${project.shortname}/settings`" class="settings">
                      <img
                        style="width: 11px; margin: 3px 8px 0 0"
                        src="/img/settings.svg"
                      />
                    </a>
                    <a :href="`/project/${project.shortname}`"> {{ project.name || "Untitled" }} </a>
                  </td>
                  <td>{{project.files.list.length}}</td>
                  <td>{{project.collaborators.list.length}}</td>
                  <td>
                    <a :href="`/user/${project.owner}`"> {{project.owner}} </a>
                  </td>
                  <td>{{new Date(project.created).toLocaleDateString()}}</td>
                </tr>
              </tbody>
            </Table>
          </Tab>
          <Tab title="Settings">
            <form class="embed-preferences">
              <h3>Embed</h3>
              <p>Limit embedding of my contents to the following hosts (1 item by line):</p>
              <textarea placeholder="google.com" name="allowedHosts"></textarea>
              <div class="action-buttons">
                <button className="push-button" type="submit">Save</button>
            </div>
            </form>
            <h3>Account</h3>
            <dialog ref="removeAccountDialog" class="removeAccountDialog">
              <form action="#" method="POST">
                <p>
                  Are you sure you want to delete your account?
                </p>
                <div class="action-buttons">
                  <button className="push-button" value="cancel" formmethod="dialog">Cancel</button>
                  <button className="push-button danger" type="submit" value="default">Delete account</button>
                </div>
              </form>
            </dialog>
            <button class="push-button danger" @click.prevent="showRemoveAccountDialog">Remove account</button>
          </Tab>
        </Tabs>
      </template>
    </UserPage>
  </template>
  <script setup>
  import { ref, onMounted } from "vue";
  import { UserPage, Tabs, Tab, Table } from "nwl-components";
  const projects = ref([]);
  const removeAccountDialog = ref(null);
  
  const props = defineProps({
      user: Object,
  })

  const fetchProjects = async () => {
    const res = await (await fetch(`/user/json/${props.user.username}/projects?start=${projects.value.length}&length=100`)).json();
    if (res.successful & (res.list.length > 0)) {
        projects.value.push(...res.list);
    }
  };
 
  onMounted(() => {
    fetchProjects();
  });

  const showRemoveAccountDialog = () => {
    removeAccountDialog.value.showModal();
  }

</script>

<style scoped>
#projects {
  table-layout: auto;
}
#projects td {
  padding: 0 4px;
}
#projects a {
  text-decoration: none;
}
.settings {
  opacity: 0.5;
  transition: opacity 500ms;
}
.settings:hover {
  opacity: 1;
}
.push-button {
  border: 1px solid #ccc;
  padding: 10px;
  background: #222;    
  color: white;
}
.push-button + .push-button {
  margin-left: 10px;
}
.push-button.danger {
  background: red;
  font-weight: bold;
}

.removeAccountDialog {
  background: #222;
  box-shadow: 0 0 5px rgba(200,200,200,0.6);
  border: 1px solid #333;
  width: 300px;
  padding: 20px;
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
}

.embed-preferences p {
  text-align: left;
}

.embed-preferences textarea {
  height: 100px;
  width: 100%;
}
</style>