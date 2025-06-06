window.ProjectList = {
    template: `
        <div class="min-h-screen bg-deep-space p-6">
            <div class="max-w-7xl mx-auto">
                <!-- Projects Header -->
                <div class="mb-8">
                    <h1 class="text-2xl font-space font-bold text-secondary mb-2">Projects</h1>
                    <p class="text-accent/80">Manage your AI agent projects</p>
                </div>

                <!-- Projects Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div v-if="loading" class="col-span-full flex justify-center py-12">
                        <loading-spinner></loading-spinner>
                    </div>

                    <div v-else-if="projects.length === 0" 
                         class="col-span-full text-center py-12">
                        <div class="text-accent/60">
                            <i class="fas fa-project-diagram text-4xl mb-4"></i>
                            <p>No projects yet. Start by creating a new project!</p>
                        </div>
                    </div>

                    <div v-else v-for="project in projects" 
                         :key="project.id"
                         class="card-3d bg-primary border border-secondary/20 rounded-2xl p-6 hover:border-secondary/40 transition-colors">
                        <div class="flex items-start justify-between mb-4">
                            <div>
                                <h2 class="text-lg font-space font-bold text-secondary">{{ project.name }}</h2>
                                <p class="text-accent/80 text-sm">{{ project.description }}</p>
                            </div>
                            <span class="px-2 py-1 rounded-full text-xs"
                                  :class="{
                                      'bg-success/10 text-success': project.status === 'active',
                                      'bg-warning/10 text-warning': project.status === 'pending',
                                      'bg-error/10 text-error': project.status === 'failed'
                                  }">
                                {{ project.status }}
                            </span>
                        </div>

                        <div class="space-y-4">
                            <!-- Project Stats -->
                            <div class="grid grid-cols-3 gap-4">
                                <div class="text-center">
                                    <div class="text-secondary font-bold">{{ project.agentsCount }}</div>
                                    <div class="text-accent/60 text-sm">Agents</div>
                                </div>
                                <div class="text-center">
                                    <div class="text-secondary font-bold">{{ project.tasksCompleted }}</div>
                                    <div class="text-accent/60 text-sm">Tasks</div>
                                </div>
                                <div class="text-center">
                                    <div class="text-secondary font-bold">{{ project.successRate }}%</div>
                                    <div class="text-accent/60 text-sm">Success</div>
                                </div>
                            </div>

                            <!-- Project Actions -->
                            <div class="flex justify-end space-x-2">
                                <button @click="viewProject(project.id)"
                                        class="px-3 py-1 text-sm text-secondary hover:text-secondary/80 transition-colors">
                                    View Details
                                </button>
                                <button v-if="project.status === 'active'"
                                        @click="pauseProject(project.id)"
                                        class="px-3 py-1 text-sm text-warning hover:text-warning/80 transition-colors">
                                    Pause
                                </button>
                                <button v-else-if="project.status === 'pending'"
                                        @click="startProject(project.id)"
                                        class="px-3 py-1 text-sm text-success hover:text-success/80 transition-colors">
                                    Start
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="fixed bottom-6 right-6">
                    <button @click="createProject"
                            class="metallic-gold px-6 py-3 rounded-lg text-primary font-medium 
                                   transform hover:scale-[1.02] transition-transform flex items-center space-x-2">
                        <i class="fas fa-plus"></i>
                        <span>New Project</span>
                    </button>
                </div>
            </div>
        </div>
    `,

    setup() {
        const { ref, onMounted } = window.Vue;

        const loading = ref(false);
        const projects = ref([
            {
                id: 1,
                name: 'Website Redesign',
                description: 'AI-assisted website redesign project',
                status: 'active',
                agentsCount: 3,
                tasksCompleted: 45,
                successRate: 98
            },
            {
                id: 2,
                name: 'Code Refactoring',
                description: 'Automated code refactoring and optimization',
                status: 'pending',
                agentsCount: 2,
                tasksCompleted: 12,
                successRate: 85
            }
        ]);

        const createProject = () => {
            // TODO: Implement project creation
            console.log('Creating new project...');
        };

        const viewProject = (projectId) => {
            // TODO: Implement project view
            console.log('Viewing project:', projectId);
        };

        const pauseProject = (projectId) => {
            // TODO: Implement project pause
            console.log('Pausing project:', projectId);
        };

        const startProject = (projectId) => {
            // TODO: Implement project start
            console.log('Starting project:', projectId);
        };

        const fetchProjects = async () => {
            try {
                loading.value = true;
                // TODO: Implement API call to fetch projects
                await new Promise(resolve => setTimeout(resolve, 1000)); // Simulated delay
            } catch (error) {
                console.error('Failed to fetch projects:', error);
            } finally {
                loading.value = false;
            }
        };

        onMounted(() => {
            fetchProjects();
        });

        return {
            loading,
            projects,
            createProject,
            viewProject,
            pauseProject,
            startProject
        };
    }
};
