window.settings = {
    namespaced: true,

    state: {
        settings: {
            vertexAIKey: null,
        },
        isLoading: false,
        error: null
    },

    mutations: {
        SET_SETTINGS(state, settings) {
            state.settings = settings;
        },
        SET_LOADING(state, isLoading) {
            state.isLoading = isLoading;
        },
        SET_ERROR(state, error) {
            state.error = error;
        }
    },

    actions: {
        async getSettings({ commit }) {
            try {
                commit('SET_LOADING', true);
                const response = await window.api.get('/api/settings');
                commit('SET_SETTINGS', response.data);
                return response.data;
            } catch (error) {
                commit('SET_ERROR', error.response?.data?.message || 'Failed to fetch settings');
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        },

        async saveVertexAIKey({ commit }, apiKey) {
            try {
                commit('SET_LOADING', true);
                const response = await window.api.post('/api/settings/vertex-ai-key', { apiKey });
                commit('SET_SETTINGS', response.data);
                return response.data;
            } catch (error) {
                commit('SET_ERROR', error.response?.data?.message || 'Failed to save API key');
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        },

        async testVertexAIConnection({ commit, state }) {
            try {
                commit('SET_LOADING', true);
                const response = await window.api.post('/api/settings/test-vertex-ai');
                return response.data;
            } catch (error) {
                commit('SET_ERROR', error.response?.data?.message || 'Connection test failed');
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        }
    },

    getters: {
        hasVertexAIKey: state => !!state.settings.vertexAIKey,
        isLoading: state => state.isLoading,
        error: state => state.error
    }
};
