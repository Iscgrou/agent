window.ApiSettings = {
    template: `
        <div class="card-3d bg-primary border border-secondary/20 rounded-2xl p-6">
            <h2 class="text-xl font-space font-bold text-secondary mb-4">API Settings</h2>
            
            <!-- Vertex AI API Key Section -->
            <div class="space-y-4">
                <div class="space-y-2">
                    <label class="block text-sm font-medium text-accent">
                        Vertex AI API Key
                    </label>
                    <div class="relative">
                        <input 
                            :type="showApiKey ? 'text' : 'password'"
                            v-model="apiKey"
                            class="w-full px-4 py-3 bg-dark-charcoal border border-secondary/20 rounded-lg 
                                   focus:outline-none focus:border-secondary transition-colors
                                   text-accent placeholder-accent/50"
                            placeholder="Enter your Vertex AI API Key"
                        />
                        <button 
                            type="button"
                            @click="toggleApiKeyVisibility"
                            class="absolute right-12 top-1/2 transform -translate-y-1/2 text-secondary/50 hover:text-secondary"
                        >
                            <i :class="showApiKey ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
                        </button>
                        <button 
                            type="button"
                            @click="saveApiKey"
                            class="absolute right-4 top-1/2 transform -translate-y-1/2 text-secondary/50 hover:text-secondary"
                        >
                            <i class="fas fa-save"></i>
                        </button>
                    </div>
                </div>

                <!-- Status Message -->
                <div v-if="statusMessage" 
                     :class="{'text-success': !isError, 'text-error': isError}"
                     class="text-sm mt-2">
                    {{ statusMessage }}
                </div>

                <!-- API Key Info -->
                <div class="mt-4 p-4 bg-dark-charcoal/50 rounded-lg">
                    <h3 class="text-sm font-medium text-accent mb-2">About Vertex AI API Key</h3>
                    <p class="text-sm text-accent/70">
                        The Vertex AI API key is required for accessing Google Cloud's AI and Machine Learning services. 
                        To obtain an API key:
                    </p>
                    <ol class="list-decimal list-inside text-sm text-accent/70 mt-2 space-y-1">
                        <li>Go to the Google Cloud Console</li>
                        <li>Navigate to APIs & Services > Credentials</li>
                        <li>Click "Create Credentials" > "API key"</li>
                        <li>Copy the generated key and paste it here</li>
                    </ol>
                    <div class="mt-3 text-sm text-warning">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        Keep your API key secure and never share it publicly
                    </div>
                </div>

                <!-- Test Connection Button -->
                <button 
                    @click="testConnection"
                    :disabled="!apiKey"
                    class="w-full mt-4 py-3 px-4 metallic-gold text-primary font-medium rounded-lg
                           transform hover:scale-[1.02] transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center space-x-2"
                >
                    <i class="fas fa-plug"></i>
                    <span>Test Connection</span>
                </button>
            </div>
        </div>
    `,

    setup() {
        const store = window.Vuex.useStore();
        const { ref, onMounted } = window.Vue;

        const apiKey = ref('');
        const showApiKey = ref(false);
        const statusMessage = ref('');
        const isError = ref(false);
        const isLoading = ref(false);

        const toggleApiKeyVisibility = () => {
            showApiKey.value = !showApiKey.value;
        };

        const saveApiKey = async () => {
            try {
                isLoading.value = true;
                statusMessage.value = '';

                // Call API to save the key
                await store.dispatch('settings/saveVertexAIKey', apiKey.value);

                statusMessage.value = 'API key saved successfully';
                isError.value = false;
            } catch (error) {
                statusMessage.value = error.message || 'Failed to save API key';
                isError.value = true;
            } finally {
                isLoading.value = false;
            }
        };

        const testConnection = async () => {
            try {
                isLoading.value = true;
                statusMessage.value = '';

                // Call API to test the connection
                await store.dispatch('settings/testVertexAIConnection');

                statusMessage.value = 'Connection successful';
                isError.value = false;
            } catch (error) {
                statusMessage.value = error.message || 'Connection failed';
                isError.value = true;
            } finally {
                isLoading.value = false;
            }
        };

        const loadApiKey = async () => {
            try {
                const settings = await store.dispatch('settings/getSettings');
                apiKey.value = settings.vertexAIKey || '';
            } catch (error) {
                console.error('Failed to load API key:', error);
            }
        };

        onMounted(() => {
            loadApiKey();
        });

        return {
            apiKey,
            showApiKey,
            statusMessage,
            isError,
            isLoading,
            toggleApiKeyVisibility,
            saveApiKey,
            testConnection
        };
    }
};
