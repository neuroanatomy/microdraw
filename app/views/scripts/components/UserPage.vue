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
        </Tabs>
      </template>
    </UserPage>
  </template>
  <script setup>
  import { ref, onMounted } from "vue";
  import { UserPage, Tabs, Tab, Table } from "nwl-components";
  const projects = ref([]);
  
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
  </style>