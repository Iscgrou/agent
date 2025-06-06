window.Dashboard = {
    template: `
        <div class="min-h-screen bg-deep-space p-6">
            <!-- Dashboard Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- Welcome Card -->
                <div class="lg:col-span-2 card-3d bg-primary border border-secondary/20 rounded-2xl p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <h1 class="text-2xl font-space font-bold text-secondary mb-2">
                                Welcome back, {{ user?.fullName || 'User' }}
                            </h1>
                            <p class="text-accent/80">Here's your AI agent platform overview</p>
                        </div>
                        <div class="metallic-gold p-4 rounded-full">
                            <i class="fas fa-robot text-primary text-2xl"></i>
                        </div>
                    </div>
                </div>

                <!-- Quick Stats Card -->
                <div class="card-3d bg-primary border border-secondary/20 rounded-2xl p-6">
                    <h2 class="text-lg font-space font-bold text-secondary mb-4">Quick Stats</h2>
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <span class="text-accent/80">Active Projects</span>
                            <span class="text-secondary font-bold">{{ stats.activeProjects }}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-accent/80">Running Agents</span>
                            <span class="text-secondary font-bold">{{ stats.runningAgents }}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-accent/80">Tasks Completed</span>
                            <span class="text-secondary font-bold">{{ stats.tasksCompleted }}</span>
                        </div>
                    </div>
                </div>

                <!-- Recent Projects -->
                <div class="lg:col-span-2 card-3d bg-primary border border-secondary/20 rounded-2xl p-6">
                    <h2 class="text-lg font-space font-bold text-secondary mb-4">Recent Projects</h2>
                    <div class="space-y-4">
                        <div v-if="projects.length === 0" class="text-accent/60 text-center py-8">
                            No projects yet. Start by creating a new project!
                        </div>
                        <div v-for="project in projects" 
                             :key="project.id"
                             class="flex items-center justify-between p-4 bg-dark-charcoal rounded-lg border border-secondary/10 hover:border-secondary/30 transition-colors">
                            <div class="flex items-center space-x-4">
                                <div class="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center">
                                    <i class="fas fa-project-diagram text-secondary"></i>
                                </div>
                                <div>
                                    <h3 class="text-accent font-medium">{{ project.name }}</h3>
                                    <p class="text-accent/60 text-sm">{{ project.description }}</p>
                                </div>
                            </div>
                            <div class="flex items-center space-x-2">
                                <span class="px-2 py-1 rounded-full text-xs"
                                      :class="{
                                          'bg-success/10 text-success': project.status === 'active',
                                          'bg-warning/10 text-warning': project.status === 'pending',
                                          'bg-error/10 text-error': project.status === 'failed'
                                      }">
                                    {{ project.status }}
                                </span>
                                <button class="text-secondary hover:text-secondary/80 transition-colors">
                                    <i class="fas fa-chevron-right"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- System Status -->
                <div class="card-3d bg-primary border border-secondary/20 rounded-2xl p-6">
                    <h2 class="text-lg font-space font-bold text-secondary mb-4">System Status</h2>
                    <div class="space-y-4">
                        <div v-for="service in systemStatus" 
                             :key="service.name"
                             class="flex items-center justify-between">
                            <span class="text-accent/80">{{ service.name }}</span>
                            <div class="flex items-center space-x-2">
                                <span class="w-2 h-2 rounded-full"
                                      :class="{
                                          'bg-success': service.status === 'operational',
                                          'bg-warning': service.status === 'degraded',
                                          'bg-error': service.status === 'down'
                                      }">
                                </span>
                                <span class="text-sm"
                                      :class="{
                                          'text-success': service.status === 'operational',
                                          'text-warning': service.status === 'degraded',
                                          'text-error': service.status === 'down'
                                      }">
                                    {{ service.status }}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="fixed bottom-6 right-6 flex space-x-4">
                <button @click="createProject"
                        class="metallic-gold px-6 py-3 rounded-lg text-primary font-medium 
                               transform hover:scale-[1.02] transition-transform flex items-center space-x-2">
                    <i class="fas fa-plus"></i>
                    <span>New Project</span>
                </button>
                
                <!-- Admin Settings Button -->
                <button v-if="isAdmin"
                        @click="goToSettings"
                        class="bg-dark-charcoal border border-secondary/20 px-6 py-3 rounded-lg text-secondary font-medium 
                               hover:bg-dark-charcoal/80 transition-colors flex items-center space-x-2">
                    <i class="fas fa-cog"></i>
                    <span>API Settings</span>
                </button>
            </div>
        </div>
    `,

    setup() {
        const store = window.Vuex.useStore();
        const router = window.VueRouter.useRouter();
        const { ref, computed, onMounted } = window.Vue;

        const stats = ref({
            activeProjects: 0,
            runningAgents: 0,
            tasksCompleted: 0
        });

        const projects = ref([
            {
                id: 1,
                name: 'Website Redesign',
                description: 'AI-assisted website redesign project',
                status: 'active'
            },
            {
                id: 2,
                name: 'Code Refactoring',
                description: 'Automated code refactoring and optimization',
                status: 'pending'
            }
        ]);

        const systemStatus = ref([
            {
                name: 'AI Engine',
                status: 'operational'
            },
            {
                name: 'Database',
                status: 'operational'
            },
            {
                name: 'API Services',
                status: 'operational'
            },
            {
                name: 'Task Queue',
                status: 'operational'
            }
        ]);

        const user = computed(() => store.state.auth.user);
        const isAdmin = computed(() => user.value?.role === 'admin');

        const createProject = () => {
            // TODO: Implement project creation
            console.log('Creating new project...');
        };

        const goToSettings = () => {
            router.push('/settings/api');
        };

        const fetchDashboardData = async () => {
            try {
                // TODO: Implement API calls to fetch real data
                stats.value.activeProjects = 2;
                stats.value.runningAgents = 3;
                stats.value.tasksCompleted = 15;
            } catch (error) {
                console.error('Failed to fetch dashboard data:', error);
            }
        };

        onMounted(() => {
            fetchDashboardData();
        });

        return {
            stats,
            projects,
            systemStatus,
            user,
            isAdmin,
            createProject,
            goToSettings
        };
    }
};
