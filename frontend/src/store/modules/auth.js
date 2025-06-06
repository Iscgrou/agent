window.auth = {
    namespaced: true,
    state: () => ({
        user: null,
        isAuthenticated: false,
        loading: false,
        error: null
    }),
    mutations: {
        SET_USER(state, user) {
            state.user = user;
            state.isAuthenticated = !!user;
        },
        SET_LOADING(state, loading) {
            state.loading = loading;
        },
        SET_ERROR(state, error) {
            state.error = error;
        },
        CLEAR_ERROR(state) {
            state.error = null;
        }
    },
    actions: {
        async login({ commit }, { email, password }) {
            commit('SET_LOADING', true);
            commit('CLEAR_ERROR');
            try {
                const user = await window.authService.login(email, password);
                commit('SET_USER', user);
                return user;
            } catch (error) {
                commit('SET_ERROR', error.message);
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        },
        async register({ commit }, userData) {
            commit('SET_LOADING', true);
            commit('CLEAR_ERROR');
            try {
                const user = await window.authService.register(userData);
                commit('SET_USER', user);
                return user;
            } catch (error) {
                commit('SET_ERROR', error.message);
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        },
        async logout({ commit }) {
            commit('SET_LOADING', true);
            try {
                await window.authService.logout();
                commit('SET_USER', null);
            } catch (error) {
                commit('SET_ERROR', error.message);
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        },
        async fetchUserProfile({ commit }) {
            commit('SET_LOADING', true);
            try {
                const user = await window.authService.getCurrentUser();
                commit('SET_USER', user);
                return user;
            } catch (error) {
                commit('SET_ERROR', error.message);
                throw error;
            } finally {
                commit('SET_LOADING', false);
            }
        },
        async checkAuth({ commit }) {
            try {
                const isAuthenticated = await window.authService.isAuthenticated();
                if (isAuthenticated) {
                    const user = await window.authService.getCurrentUser();
                    commit('SET_USER', user);
                } else {
                    commit('SET_USER', null);
                }
                return isAuthenticated;
            } catch (error) {
                commit('SET_USER', null);
                return false;
            }
        }
    },
    getters: {
        isAuthenticated: state => state.isAuthenticated,
        user: state => state.user,
        loading: state => state.loading,
        error: state => state.error
    }
};
