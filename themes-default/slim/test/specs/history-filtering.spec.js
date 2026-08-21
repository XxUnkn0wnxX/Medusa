import Vuex from 'vuex';
import { createLocalVue, shallowMount } from '@vue/test-utils';
import HistoryDetailed from '../../src/components/history-detailed.vue';
import HistoryCompact from '../../src/components/history-compact.vue';

const VueGoodTableStub = {
    props: ['columns', 'rows', 'totalRows', 'searchOptions', 'sortOptions', 'paginationOptions', 'columnFilterOptions', 'rowStyleClass', 'styleClass'],
    render(h) {
        const slot = this.$scopedSlots['column-filter'];
        return h('div', [slot ? slot({
            column: {
                field: 'episodeTitle'
            }
        }) : null]);
    }
};

const consts = {
    qualities: {
        values: [{
            value: '1',
            text: 'test'
        }]
    },
    clientStatuses: [{
        value: 1,
        name: 'test'
    }, {
        value: 2,
        name: 'also'
    }]
};

const createLocalVueForHistory = () => {
    const localVue = createLocalVue();
    localVue.use(Vuex);
    return localVue;
};

const createHistoryStore = (history = {}) => {
    const {
        remote = {},
        remoteCompact = {},
        ...historyState
    } = history;
    const remoteStateDefaults = {
        page: 2,
        perPage: 25,
        sort: [{ field: 'date', type: 'desc' }],
        filter: {
            columnFilters: {}
        },
        rows: [],
        totalRows: 0
    };

    return new Vuex.Store({
        state: {},
        modules: {
            config: {
                state: {
                    consts
                }
            },
            history: {
                state: {
                    remote: {
                        ...remoteStateDefaults,
                        ...remote
                    },
                    remoteCompact: {
                        ...remoteStateDefaults,
                        ...remoteCompact
                    },
                    ...historyState
                }
            }
        },
        actions: {
            getHistory: jest.fn(),
            checkHistory: jest.fn(),
            setStoreLayout: jest.fn()
        },
        getters: {
            fuzzyParseDateTime: () => () => ''
        }
    });
};

const makeMountedHistoryComponent = (component, cookieStore = {}) => {
    const getCookie = jest.fn(key => {
        return cookieStore[key];
    });
    const setCookie = jest.fn((key, value) => {
        cookieStore[key] = value;
    });
    const loadItems = jest.fn();

    return {
        ...component,
        methods: {
            ...(component.methods || {}),
            getCookie,
            setCookie,
            loadItems
        },
        __testMocks: {
            getCookie,
            setCookie,
            loadItems
        }
    };
};

const mountDetailed = (history = {}) => {
    const localVue = createLocalVueForHistory();
    const store = createHistoryStore(history);
    const cookieStore = {};
    const component = makeMountedHistoryComponent(HistoryDetailed, cookieStore);

    const wrapper = shallowMount(component, {
        localVue,
        store,
        stubs: {
            VueGoodTable: VueGoodTableStub,
            AppLink: true,
            QualityPill: true,
            FontAwesomeIcon: true,
            Multiselect: true
        }
    });
    wrapper.vm.loadItemsDebounced = jest.fn();
    return {
        wrapper,
        store,
        cookieStore,
        ...component.__testMocks
    };
};

const mountCompact = (history = {}) => {
    const localVue = createLocalVueForHistory();
    const store = createHistoryStore(history);
    const cookieStore = {};
    const component = makeMountedHistoryComponent(HistoryCompact, cookieStore);

    const wrapper = shallowMount(component, {
        localVue,
        store,
        stubs: {
            VueGoodTable: VueGoodTableStub,
            AppLink: true,
            QualityPill: true
        }
    });

    wrapper.vm.loadItemsDebounced = jest.fn();
    return {
        wrapper,
        store,
        cookieStore,
        ...component.__testMocks
    };
};

describe('History filter state composition', () => {
    it('detailed onColumnFilter merges native action changes while preserving manual filters', () => {
        const { wrapper, setCookie } = mountDetailed({
            remote: {
                page: 4,
                filter: {
                    columnFilters: {
                        resource: 'The Show',
                        providerId: 'provider-a',
                        quality: '1080p',
                        size: '< 1024',
                        clientStatus: 5,
                        statusName: 'Downloaded'
                    }
                }
            }
        });

        setCookie.mockClear();
        wrapper.vm.loadItemsDebounced.mockClear();

        wrapper.vm.onColumnFilter({
            columnFilters: {
                statusName: 'Failed'
            }
        });

        expect(wrapper.vm.remoteHistory.page).toBe(1);
        expect(wrapper.vm.remoteHistory.filter).toEqual({
            columnFilters: {
                resource: 'The Show',
                providerId: 'provider-a',
                quality: '1080p',
                size: '< 1024',
                clientStatus: 5,
                statusName: 'Failed'
            }
        });
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(setCookie).toHaveBeenCalledWith('filter', wrapper.vm.remoteHistory.filter);
        wrapper.destroy();
    });

    it('detailed onColumnFilter keeps statusName cleared and fully resets native keys on empty map', () => {
        const { wrapper } = mountDetailed({
            remote: {
                page: 3,
                filter: {
                    columnFilters: {
                        resource: 'The Show',
                        providerId: 'provider-a',
                        quality: '1080p',
                        size: '< 1024',
                        clientStatus: 5,
                        statusName: 'Downloaded'
                    }
                }
            }
        });

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.onColumnFilter({
            columnFilters: {
                statusName: ''
            }
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters).toEqual({
            resource: 'The Show',
            providerId: 'provider-a',
            quality: '1080p',
            size: '< 1024',
            clientStatus: 5,
            statusName: ''
        });
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(wrapper.vm.remoteHistory.page).toBe(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.onColumnFilter({
            columnFilters: {}
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters).toEqual({
            resource: 'The Show',
            providerId: 'provider-a',
            quality: '1080p',
            size: '< 1024',
            clientStatus: 5
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters.statusName).toBeUndefined();
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(wrapper.vm.remoteHistory.page).toBe(1);
        wrapper.destroy();
    });

    it('detailed manual filters preserve other fields and queue one load per valid update', () => {
        const { wrapper, setCookie } = mountDetailed({
            remote: {
                page: 9,
                filter: {
                    columnFilters: {
                        resource: 'old resource',
                        providerId: 'old provider',
                        quality: '720p',
                        size: '< 1024',
                        clientStatus: 1,
                        statusName: 'Downloaded'
                    }
                }
            }
        });
        setCookie.mockClear();

        wrapper.vm.updateResource({
            currentTarget: {
                value: 'new resource'
            }
        });
        expect(wrapper.vm.remoteHistory.page).toBe(1);
        expect(wrapper.vm.remoteHistory.filter.columnFilters).toEqual({
            resource: 'new resource',
            providerId: 'old provider',
            quality: '720p',
            size: '< 1024',
            clientStatus: 1,
            statusName: 'Downloaded'
        });
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateProvider({
            currentTarget: {
                value: 'new provider'
            }
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters.providerId).toBe('new provider');
        expect(wrapper.vm.remoteHistory.page).toBe(1);
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateQualityFilter({
            currentTarget: {
                value: '1080p'
            }
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters.quality).toBe('1080p');
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateClientStatusFilter([{
            value: 1
        }, {
            value: 2
        }]);
        expect(wrapper.vm.selectedClientStatusValue).toEqual([{
            value: 1
        }, {
            value: 2
        }]);
        expect(wrapper.vm.remoteHistory.filter.columnFilters.clientStatus).toBe(3);
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateSizeFilter({
            currentTarget: {
                value: '> 2048'
            }
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters.size).toBe('> 2048');
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateSizeFilter({
            currentTarget: {
                value: ''
            }
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters.size).toBe('');
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateSizeFilter({
            currentTarget: {
                value: 'abc'
            }
        });
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(0);
        expect(setCookie).toHaveBeenCalledTimes(0);
        wrapper.destroy();
    });

    it('detailed manual update from null filter is safe', () => {
        const { wrapper } = mountDetailed({
            remote: {
                page: 6,
                filter: null
            }
        });

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.updateProvider({
            currentTarget: {
                value: 'provider-null-safe'
            }
        });

        expect(wrapper.vm.remoteHistory.filter).toEqual({
            columnFilters: {
                providerId: 'provider-null-safe'
            }
        });
        expect(wrapper.vm.remoteHistory.page).toBe(1);
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        wrapper.destroy();
    });

    it('compact resource filter preserves existing filter keys and only updates remoteCompact page', () => {
        const sharedHistory = {
            remote: {
                page: 10,
                filter: {
                    columnFilters: {
                        statusName: 'Downloaded',
                        other: 'detail only'
                    }
                }
            },
            remoteCompact: {
                page: 7,
                filter: {
                    columnFilters: {
                        resource: 'old compact',
                        statusName: 'Downloaded'
                    }
                }
            }
        };
        const localVue = createLocalVueForHistory();
        const store = createHistoryStore(sharedHistory);
        const cookieStore = {};
        const detailedComponent = makeMountedHistoryComponent(HistoryDetailed, cookieStore);
        const compactComponent = makeMountedHistoryComponent(HistoryCompact, cookieStore);

        const detailed = shallowMount(detailedComponent, {
            localVue,
            store,
            stubs: {
                VueGoodTable: VueGoodTableStub,
                AppLink: true,
                QualityPill: true,
                FontAwesomeIcon: true,
                Multiselect: true
            }
        });
        const compact = shallowMount(compactComponent, {
            localVue,
            store,
            stubs: {
                VueGoodTable: VueGoodTableStub,
                AppLink: true,
                QualityPill: true
            }
        });
        const compactSetCookie = compactComponent.__testMocks.setCookie;
        const detailedSetCookie = detailedComponent.__testMocks.setCookie;
        compactSetCookie.mockClear();
        detailedSetCookie.mockClear();

        detailed.vm.loadItemsDebounced = jest.fn();
        compact.vm.loadItemsDebounced = jest.fn();

        compact.vm.updateResource({
            currentTarget: {
                value: 'new compact'
            }
        });

        expect(compact.vm.remoteHistory.page).toBe(1);
        expect(compact.vm.remoteHistory.filter.columnFilters).toEqual({
            resource: 'new compact',
            statusName: 'Downloaded'
        });
        expect(detailed.vm.remoteHistory.page).toBe(10);
        expect(detailed.vm.remoteHistory.filter).toEqual({
            columnFilters: {
                statusName: 'Downloaded',
                other: 'detail only'
            }
        });
        expect(compact.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(detailed.vm.loadItemsDebounced).toHaveBeenCalledTimes(0);
        expect(compactSetCookie).toHaveBeenCalledTimes(0);
        expect(detailedSetCookie).toHaveBeenCalledTimes(0);
        detailed.destroy();
        compact.destroy();
    });

    it('detailed mutations do not alter compact state', () => {
        const sharedHistory = {
            remote: {
                page: 5,
                filter: {
                    columnFilters: {
                        resource: 'detailed-only',
                        providerId: 'detailed-provider',
                        clientStatus: 1,
                        quality: '720p',
                        size: '< 500',
                        statusName: 'Downloaded'
                    }
                }
            },
            remoteCompact: {
                page: 8,
                filter: {
                    columnFilters: {
                        resource: 'compact-only'
                    }
                }
            }
        };
        const localVue = createLocalVueForHistory();
        const store = createHistoryStore(sharedHistory);
        const cookieStore = {};
        const detailedComponent = makeMountedHistoryComponent(HistoryDetailed, cookieStore);
        const compactComponent = makeMountedHistoryComponent(HistoryCompact, cookieStore);

        const detailed = shallowMount(detailedComponent, {
            localVue,
            store,
            stubs: {
                VueGoodTable: VueGoodTableStub,
                AppLink: true,
                QualityPill: true,
                FontAwesomeIcon: true,
                Multiselect: true
            }
        });
        const compact = shallowMount(compactComponent, {
            localVue,
            store,
            stubs: {
                VueGoodTable: VueGoodTableStub,
                AppLink: true,
                QualityPill: true
            }
        });
        const compactSetCookie = compactComponent.__testMocks.setCookie;
        compactSetCookie.mockClear();

        detailed.vm.loadItemsDebounced = jest.fn();
        compact.vm.loadItemsDebounced = jest.fn();

        const compactPageBefore = compact.vm.remoteHistory.page;
        const compactFilterBefore = JSON.parse(JSON.stringify(compact.vm.remoteHistory.filter));
        detailed.vm.updateResource({
            currentTarget: {
                value: 'detailed-updated'
            }
        });
        expect(detailed.vm.remoteHistory.filter.columnFilters.resource).toBe('detailed-updated');
        expect(compact.vm.remoteHistory.page).toBe(compactPageBefore);
        expect(compact.vm.remoteHistory.filter).toEqual(compactFilterBefore);
        expect(compact.vm.remoteHistory.filter).not.toEqual(detailed.vm.remoteHistory.filter);
        expect(detailed.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(compact.vm.loadItemsDebounced).toHaveBeenCalledTimes(0);
        expect(compactSetCookie).toHaveBeenCalledTimes(0);
        compact.destroy();
        detailed.destroy();
    });

    it('compact mutations do not alter detailed state', () => {
        const sharedHistory = {
            remote: {
                page: 5,
                filter: {
                    columnFilters: {
                        resource: 'detailed-only',
                        providerId: 'detailed-provider',
                        clientStatus: 1,
                        quality: '720p',
                        size: '< 500',
                        statusName: 'Downloaded'
                    }
                }
            },
            remoteCompact: {
                page: 8,
                filter: {
                    columnFilters: {
                        resource: 'compact-only'
                    }
                }
            }
        };
        const localVue = createLocalVueForHistory();
        const store = createHistoryStore(sharedHistory);
        const cookieStore = {};
        const detailedComponent = makeMountedHistoryComponent(HistoryDetailed, cookieStore);
        const compactComponent = makeMountedHistoryComponent(HistoryCompact, cookieStore);

        const detailed = shallowMount(detailedComponent, {
            localVue,
            store,
            stubs: {
                VueGoodTable: VueGoodTableStub,
                AppLink: true,
                QualityPill: true,
                FontAwesomeIcon: true,
                Multiselect: true
            }
        });
        const compact = shallowMount(compactComponent, {
            localVue,
            store,
            stubs: {
                VueGoodTable: VueGoodTableStub,
                AppLink: true,
                QualityPill: true
            }
        });
        const compactSetCookie = compactComponent.__testMocks.setCookie;
        compactSetCookie.mockClear();

        detailed.vm.loadItemsDebounced = jest.fn();
        compact.vm.loadItemsDebounced = jest.fn();

        const detailedPageBefore = detailed.vm.remoteHistory.page;
        const detailedFilterBefore = JSON.parse(JSON.stringify(detailed.vm.remoteHistory.filter));
        compact.vm.updateResource({
            currentTarget: {
                value: 'compact-updated'
            }
        });
        expect(compact.vm.remoteHistory.filter.columnFilters.resource).toBe('compact-updated');
        expect(compact.vm.remoteHistory.page).toBe(1);
        expect(detailed.vm.remoteHistory.page).toBe(detailedPageBefore);
        expect(detailed.vm.remoteHistory.filter).toEqual(detailedFilterBefore);
        expect(detailed.vm.loadItemsDebounced).toHaveBeenCalledTimes(0);
        expect(compact.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(compactSetCookie).toHaveBeenCalledTimes(0);
        compact.destroy();
        detailed.destroy();
    });

    it('compact onColumnFilter keeps resource and replaces/clears native keys with page reset and one load', () => {
        const { wrapper, setCookie } = mountCompact({
            remoteCompact: {
                page: 6,
                filter: {
                    columnFilters: {
                        resource: 'compact show',
                        statusName: 'Downloaded',
                        clientStatus: 5
                    }
                }
            }
        });
        setCookie.mockClear();

        wrapper.vm.onColumnFilter({
            columnFilters: {
                statusName: 'Failed'
            }
        });

        expect(wrapper.vm.remoteHistory.filter.columnFilters).toEqual({
            resource: 'compact show',
            statusName: 'Failed'
        });
        expect(wrapper.vm.remoteHistory.page).toBe(1);
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);

        wrapper.vm.loadItemsDebounced.mockClear();
        wrapper.vm.onColumnFilter({
            columnFilters: {}
        });
        expect(wrapper.vm.remoteHistory.filter.columnFilters).toEqual({
            resource: 'compact show'
        });
        expect(wrapper.vm.remoteHistory.page).toBe(1);
        expect(wrapper.vm.loadItemsDebounced).toHaveBeenCalledTimes(1);
        expect(setCookie).toHaveBeenCalledTimes(0);
        wrapper.destroy();
    });

    it('both components render the Episode filter placeholder as Show title or release', () => {
        const { wrapper: detailed } = mountDetailed();
        const { wrapper: compact } = mountCompact();

        expect(detailed.find('input[placeholder="Show title or release"]').exists()).toBe(true);
        expect(compact.find('input[placeholder="Show title or release"]').exists()).toBe(true);
        detailed.destroy();
        compact.destroy();
    });
});
