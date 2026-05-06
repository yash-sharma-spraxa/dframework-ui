import {
    DataGridPremium,
    GRID_CHECKBOX_SELECTION_COL_DEF,
    GridActionsCellItem,
    useGridApiRef,
    useGridApiContext,
    useGridSelector,
    gridRowSelectionStateSelector
} from '@mui/x-data-grid-premium';
import DeleteIcon from '@mui/icons-material/Delete';
import CopyIcon from '@mui/icons-material/FileCopy';
import ArticleIcon from '@mui/icons-material/Article';
import EditIcon from '@mui/icons-material/Edit';
import { useMemo, useEffect, memo, useRef, useState, useCallback } from 'react';
import { useSnackbar } from '../SnackBar/index';
import { DialogComponent } from '../Dialog/index';
import { getList, getRecord, deleteRecord, saveRecord } from './crud-helper';
import { Footer } from './footer';
import template from './template';
import { Tooltip, Box } from "@mui/material";
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import PageTitle from '../PageTitle';
import { useStateContext, useRouter } from '../useRouter/StateProvider';
import LocalizedDatePicker from './LocalizedDatePicker';
import CustomToolbar from './CustomToolbar';
import utils, { getPermissions } from '../utils';
import HistoryIcon from '@mui/icons-material/History';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import Checkbox from '@mui/material/Checkbox';
import { useModelTranslation } from '../../hooks/useModelTranslation';
import { convertDefaultSort, areEqual, getDefaultOperator } from './helper';
import { styled } from '@mui/material/styles';

const defaultPageSize = 50;
const sortRegex = /(\w+)( ASC| DESC)?/i;
const recordCounts = 60_000;
const exportPage = 0;
const exportPageSize = 1_000_000;
const actionTypes = {
    Copy: "Copy",
    Edit: "Edit",
    Delete: "Delete",
    History: "History",
    Download: "Download"
};
const iconMapper = {
    'article': <ArticleIcon />,
    'edit': <EditIcon />,
    'copy': <CopyIcon />,
    'delete': <DeleteIcon />,
    'history': <HistoryIcon />,
    'download': <FileDownloadIcon />,
};

const constants = {
    gridFilterModel: { items: [], logicOperator: 'and', quickFilterValues: Array(0), quickFilterLogicOperator: 'and' },
    permissions: { edit: true, add: true, export: true, delete: true, showColumnsOrder: true, filter: true },
    client: 'client',
    server: 'server',
    object: 'object',
    startDate: 'startDate',
    endDate: 'endDate',
    oneToMany: 'oneToMany',
    lookup: 'lookup',
    Number: 'number',
    string: 'string',
    boolean: 'boolean',
    right: 'right',
    left: 'left',
    dateTime: 'dateTime',
    actions: 'actions',
    function: 'function',
    pageSizeOptions: [5, 10, 20, 50, 100],
    defaultActionWidth: 50
};
// Operators that do not require a value
const NO_VALUE_OPERATORS = ['isEmpty', 'isNotEmpty'];

// Stable empty references used when localSortAndFilter is enabled to prevent
// fetchData from being recreated (and re-triggering API calls) on sort/filter changes
const EMPTY_SORT_MODEL = Object.freeze([]);
const EMPTY_FILTER_MODEL = Object.freeze({
    items: [],
    logicOperator: 'and',
    quickFilterValues: [],
    quickFilterLogicOperator: 'and'
});
// Stable pagination used when localSortAndFilter is enabled: always request page 0
// with a large pageSize so the backend returns all rows in one call.
const LOCAL_MODE_PAGINATION_MODEL = Object.freeze({ page: 0, pageSize: exportPageSize });

// Module-level default translate to avoid creating a new function instance every render
const defaultTranslate = (key) => key;

const normalizeStaticData = (staticData) => {
    const records = Array.isArray(staticData)
        ? staticData
        : Array.isArray(staticData?.records)
            ? staticData.records
            : [];
    return {
        records,
        recordCount: Number.isFinite(staticData?.recordCount) ? staticData.recordCount : records.length,
        lookups: (
            staticData &&
            typeof staticData.lookups === 'object' &&
            staticData.lookups !== null &&
            !Array.isArray(staticData.lookups)
        ) ? staticData.lookups : {}
    };
};

// Return only items that are valid for requests (keep no-value operators)
const filterValidItems = (items) => {
    return (items || []).filter(item => {
        if (NO_VALUE_OPERATORS.includes(item.operator)) return true;
        return item.value !== null && item.value !== undefined && item.value !== '';
    });
};

const auditColumnMappings = [
    { key: 'addCreatedOnColumn', field: 'CreatedOn', type: 'dateTime', header: 'Created On' },
    { key: 'addCreatedByColumn', field: 'CreatedByUser', type: 'string', header: 'Created By' },
    { key: 'addModifiedOnColumn', field: 'ModifiedOn', type: 'dateTime', header: 'Modified On' },
    { key: 'addModifiedByColumn', field: 'ModifiedByUser', type: 'string', header: 'Modified By' }
];
const booleanIconRenderer = (params) => {
    if (params.value) {
        return <CheckIcon style={{ color: 'green' }} />;
    } else {
        return <CloseIcon style={{ color: 'gray' }} />;
    }
};

const gridGroupByColumnName = ['__row_group_by_columns_group__', '__detail_panel_toggle__'];

const DeleteContentText = styled('span')({
    width: '100%',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
});

const CustomCheckBox = ({ params, handleSelectRow, idProperty }) => {
    const apiRef = useGridApiContext();
    const rowId = params.row[idProperty];
    // useGridSelector subscribes to state changes and triggers re-render when selection updates
    const selectionModel = useGridSelector(apiRef, gridRowSelectionStateSelector);
    const isChecked = selectionModel?.ids?.has(rowId) ?? false;

    const handleCheckboxClick = (event) => {
        event.stopPropagation();
        handleSelectRow({ row: params.row });
    };

    return (
        <Checkbox
            onClick={handleCheckboxClick}
            checked={isChecked}
            color="primary"
            value={rowId}
            inputProps={{ 'aria-label': 'checkbox' }}
        />
    );
};

const GridBase = memo(({
    model,
    columns,
    api,
    defaultSort,
    setActiveRecord,
    parentFilters,
    parent,
    where,
    title,
    showPageTitle,
    permissions,
    selected,
    assigned,
    available,
    disableCellRedirect = false,
    onAssignChange,
    customStyle,
    onCellClick,
    showRowsSelected,
    showFullScreenLoader,
    customFilters,
    onRowDoubleClick,
    onRowClick = () => { },
    gridStyle,
    reRenderKey,
    additionalFilters,
    onCellDoubleClickOverride,
    onAddOverride,
    dynamicColumns,
    toolbarItems,
    readOnly = false,
    onListParamsChange,
    apiRef: propsApiRef,
    baseFilters,
    customExportOptions,
    sx: propsSx,
    ...props
}) => {
    const staticDataSource = props.staticData ?? model.staticData;
    const hasStaticData = Array.isArray(staticDataSource) || Array.isArray(staticDataSource?.records);
    const normalizedStaticData = useMemo(
        () => hasStaticData ? normalizeStaticData(staticDataSource) : null,
        [hasStaticData, staticDataSource]
    );
    const [paginationModel, setPaginationModel] = useState({ pageSize: defaultPageSize, page: 0 });
    const [data, setData] = useState(() => normalizedStaticData || { recordCount: 0, records: null, lookups: {} });
    const forAssignment = !!onAssignChange;
    const rowsSelected = showRowsSelected;
    // MUI v8: rowSelectionModel uses object format with type ('include'/'exclude') and ids (Set)
    const [rowSelectionModel, setRowSelectionModel] = useState({
        type: 'include',
        ids: new Set()
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const [record, setRecord] = useState(null);
    const visibilityModel = { CreatedOn: false, CreatedByUser: false, ...model.columnVisibilityModel };
    const [showAddConfirmation, setShowAddConfirmation] = useState(false);
    const snackbar = useSnackbar();
    // Force client pagination when localSortAndFilter is enabled so that all data is
    // fetched in a single request and MUI DataGrid handles paging/sort/filter locally.
    const paginationMode = (hasStaticData || model.localSortAndFilter) ? constants.client : (model.paginationMode === constants.client ? constants.client : constants.server);
    const { translate, tOpts } = useModelTranslation(model);
    const [errorMessage, setErrorMessage] = useState('');
    const [sortModel, setSortModel] = useState(convertDefaultSort(defaultSort || model.defaultSort, constants, sortRegex));
    const initialFilterModel = { items: [], logicOperator: 'and', quickFilterValues: Array(0), quickFilterLogicOperator: 'and' };
    if (model.defaultFilters) {
        initialFilterModel.items = [];
        model.defaultFilters.forEach((ele) => {
            initialFilterModel.items.push(ele);
        });
    }
    const [filterModel, setFilterModel] = useState({ ...initialFilterModel });
    const { navigate, getParams, useParams, pathname } = useRouter();
    const { id: idWithOptions } = useParams() || getParams;
    const id = idWithOptions?.split('-')[0];
    const apiRef = propsApiRef || useGridApiRef();
    const backendApi = api || model.api;
    const isStaticDataWithoutBackendApi = hasStaticData && !backendApi;
    const { idProperty = "id", showHeaderFilters = true, disableRowSelectionOnClick = true, hideTopFilters = true, updatePageTitle = true, isElasticScreen = false, navigateBack = false, selectionApi = {}, debounceTimeOut = 300, showFooter = true, disableRowGrouping = true, localSortAndFilter = false } = model;
    // When localSortAndFilter is true, sorting and filtering are handled client-side by MUI DataGrid
    // even if paginationMode is server. Sort/filter values are not sent to the API.
    const sortAndFilterMode = (hasStaticData || localSortAndFilter) ? constants.client : paginationMode;
    // Use stable empty references when localSortAndFilter is enabled so that fetchData's
    // useCallback is not recreated (and the data-fetching useEffect not re-triggered)
    // when the user changes sort/filter — the DataGrid handles those changes locally.
    const sortModelForFetch = localSortAndFilter ? EMPTY_SORT_MODEL : sortModel;
    const filterModelForFetch = localSortAndFilter ? EMPTY_FILTER_MODEL : filterModel;
    // Use a stable large-page pagination when localSortAndFilter is enabled so that
    // the entire dataset is loaded in one request and user page changes don't re-trigger
    // fetchData (since all rows are already in memory for the DataGrid to page locally).
    const paginationModelForFetch = localSortAndFilter ? LOCAL_MODE_PAGINATION_MODEL : paginationModel;
    // In static mode without API endpoint, force read-only to prevent invalid CRUD requests.
    const isReadOnly = model.readOnly === true || readOnly || isStaticDataWithoutBackendApi;
    const isDoubleClicked = model.allowDoubleClick === false;
    const dataRef = useRef(data);
    const fetchAbortControllerRef = useRef(null);

    useEffect(() => () => {
        fetchAbortControllerRef.current?.abort();
        fetchAbortControllerRef.current = null;
    }, []);

    const showAddIcon = model.showAddIcon === true;
    const toLink = model.columns.filter(({ link }) => Boolean(link)).map(item => item.link);
    const { stateData, formatDate, getApiEndpoint, buildUrl, setPageTitle } = useStateContext();
    const [isLoading, setIsLoading] = useState(false);
    const { timeZone } = stateData;
    const effectivePermissions = useMemo(() => ({ ...constants.permissions, ...model.permissions, ...permissions }), [model.permissions, permissions]);
    const emptyIsAnyOfOperatorFilters = ["isEmpty", "isNotEmpty", "isAnyOf"];
    const userData = stateData.userData || {};
    const documentField = model.columns.find(ele => ele.type === 'fileUpload')?.field || "";
    const userDefinedPermissions = { add: effectivePermissions.add, edit: effectivePermissions.edit, delete: effectivePermissions.delete };
    const { canAdd, canEdit, canDelete } = getPermissions({ userData, model, userDefinedPermissions });
    const tTranslate = useMemo(() => model.tTranslate ?? defaultTranslate, [model.tTranslate]);
    const { addUrlParamKey, searchParamKey, hideBreadcrumb = false, tableName, showHistory = true, hideBreadcrumbInGrid = false, breadcrumbColor, disablePivoting = false, columnHeaderHeight = 70, disablePagination = false } = model;
    const gridTitle = model.gridTitle || model.title;
    const preferenceKey = getApiEndpoint("GridPreferenceManager") ? (model.preferenceId || model.module?.preferenceId) : null;
    const searchParams = new URLSearchParams(window.location.search);
    const [currentPreference, setCurrentPreference] = useState(null);
    const [preferencesReady, setPreferencesReady] = useState(!preferenceKey);
    const backendApiRequiredMessage = tTranslate('This action requires an API endpoint.', tOpts);
    // State for single expanded detail panel row
    const [rowPanelId, setRowPanelId] = useState(null);
    const detailPanelExpandedRowIds = useMemo(() => new Set(rowPanelId ? [rowPanelId] : []), [rowPanelId]);
    const enableRowDetailPanel = typeof model.getDetailPanelContent === 'function';
    const [groupingModel, setGroupingModel] = useState([]);

    useEffect(() => {
        if (!apiRef.current) return;
        // Store preferenceKey on apiRef for GridPreferences to access
        apiRef.current.prefKey = preferenceKey;
    }, [apiRef, preferenceKey]);

    // Callback when preferences are loaded or changed
    const onPreferenceChange = useCallback((preferenceName) => {
        setCurrentPreference(preferenceName);
        setPreferencesReady(true);
    }, []);


    // Extract column grouping props from model to override
    const columnGroupingModel = useMemo(() => {
        if (!model.columnGroupingModel) return [];
        return model.columnGroupingModel.map(group => ({
            ...group,
            headerName: group.headerName ? tTranslate(group.headerName, tOpts) : group.headerName
        }));
    }, [model.columnGroupingModel, tOpts, translate, tTranslate]);

    useEffect(() => {
        if (Array.isArray(props.rowGroupingField)) {
            setGroupingModel(props.rowGroupingField);
        } else {
            // reset grouping so previous grouping does not persist.
            setGroupingModel([]);
        }
    }, [props.rowGroupingField]);

    const baseDataFromParams = searchParams.has('baseData') && searchParams.get('baseData');
    const baseSaveData = useMemo(() => {
        if (baseDataFromParams) {
            try {
                const parsedData = JSON.parse(baseDataFromParams);
                if (typeof parsedData === constants.object && parsedData !== null) {
                    return parsedData;
                }
            } catch (error) {
                console.error('Failed to parse baseData from URL:', error);
            }
        }
        return {};
    }, [baseDataFromParams]);

    const handleSelectRow = useCallback(({ row }) => {
        const rowId = row[idProperty];
        setRowSelectionModel(prevModel => {
            const newIds = new Set(prevModel?.ids || []);
            if (newIds.has(rowId)) {
                newIds.delete(rowId);
            } else {
                newIds.add(rowId);
            }
            return { type: 'include', ids: newIds };
        });
    }, [idProperty]);

    const gridColumnTypes = {
        "radio": {
            "type": "singleSelect",
            "valueOptions": "lookup"
        },
        "date": {
            "valueFormatter": (value, row, column) => (
                formatDate({ value, useSystemFormat: true, showOnlyDate: false, state: stateData.dateTime })
            ),
            "filterOperators": LocalizedDatePicker({ columnType: "date" })
        },
        "dateTime": {
            "valueFormatter": (value, row, column) => (
                formatDate({ value, useSystemFormat: false, showOnlyDate: false, state: stateData.dateTime })
            ),
            "filterOperators": LocalizedDatePicker({ columnType: "dateTime" })
        },
        "boolean": {
            renderCell: booleanIconRenderer
        },
        "select": {
            "type": "singleSelect",
            "valueOptions": "lookup"
        },
        "lookup": {
            "type": "singleSelect",
            "valueOptions": "lookup"
        },
        "selection": {
            renderCell: (params) => <CustomCheckBox params={params} handleSelectRow={handleSelectRow} idProperty={idProperty} />
        }
    };

    useEffect(() => {
        dataRef.current = data;
        if (typeof props.onDataLoaded === 'function') {
            props.onDataLoaded(data);
        }
    }, [data]);

    useEffect(() => {
        if (hasStaticData) {
            setData(normalizedStaticData);
            return;
        }
        setData((prevData) => ({
            ...(prevData || {}),
            records: [],
            recordCount: 0,
            lookups: {}
        }));
    }, [hasStaticData, normalizedStaticData]);

    useEffect(() => {
        if (!customFilters || !Object.keys(customFilters).length) return;
        if (customFilters.clear) {
            setFilterModel({ items: [], logicOperator: "and", quickFilterValues: [], quickFilterLogicOperator: "and" });
            return;
        }
        const items = Object.entries(customFilters).reduce((acc, [key, value]) => {
            if (key === constants.startDate || key === constants.endDate) {
                acc.push(value);
            } else if (key in customFilters) {
                acc.push({ field: key, value, operator: "equals", type: "string" });
            }
            return acc;
        }, []);
        setFilterModel({ items, logicOperator: "and", quickFilterValues: [], quickFilterLogicOperator: "and" });
    }, [customFilters]);

    const lookupOptions = useCallback(({ field, lookupMap: lookupMapParam }) => {
        const lookupData = dataRef.current.lookups || {};
        const map = lookupMapParam || {};
        return map[field]?.customLookup || lookupData[map[field]?.lookup] || [];
    }, []);

    useEffect(() => {
        // Note: PASS_FILTERS_TO_HEADER was removed as component-specific state
        // This functionality should be handled locally within the Grid component if needed
        if (props.isChildGrid || !hideTopFilters) {
            return;
        }
        // TODO: If filter header communication is needed, implement using local state or props
    }, [props.isChildGrid, hideTopFilters]);

    const createAction = useCallback(
        ({ key, title, icon, color = "primary", disabled, otherProps }) => (
            <GridActionsCellItem
                key={key}
                icon={<Tooltip title={tTranslate(title, tOpts)}>{iconMapper[icon] || icon || tTranslate(title, tOpts)}</Tooltip>}
                data-action={key}
                label={tTranslate(title, tOpts)}
                color={color}
                disabled={disabled}
                {...otherProps}
            />
        ),
        [translate, tOpts, tTranslate]
    );
    const { customActions = [] } = model;
    const actionConfig = useMemo(() => {
        const actions = [];

        if (!forAssignment && !isReadOnly) {
            actions.push(
                {
                    key: actionTypes.Edit,
                    title: "Edit",
                    icon: 'edit',
                    show: !!canEdit,
                    disabled: row => row.canEdit === false
                },
                {
                    key: actionTypes.Copy,
                    title: "Copy",
                    icon: 'copy',
                    show: !!effectivePermissions.copy,
                },
                {
                    key: actionTypes.Delete,
                    title: "Delete",
                    icon: 'delete',
                    color: "error",
                    show: !!canDelete,
                },
                {
                    key: actionTypes.History,
                    title: "History",
                    icon: 'history',
                    show: !!showHistory,
                },
                ...customActions
            );
        }

        actions.push({
            key: actionTypes.Download,
            title: "Download document",
            icon: 'download',
            show: documentField.length > 0,
        });

        return actions.filter(({ show }) => show !== false);
    }, [
        forAssignment,
        isReadOnly,
        canEdit,
        canDelete,
        showHistory,
        effectivePermissions.copy,
        documentField.length,
        customActions
    ]);

    const getActions = useCallback(
        ({ row }) =>
            actionConfig
                .map(({ key, title, icon, color, disabled, show, action, ...otherProps }) =>
                    createAction({
                        key,
                        title: title || action, // Fallback to 'action' for backward compatibility if 'title' is not provided
                        icon,
                        color,
                        disabled: disabled?.(row),
                        otherProps
                    })
                ),
        [actionConfig, createAction]
    );
    // Derive a stable string from the loaded lookup names. Recomputes whenever the
    // set of lookup keys changes (e.g. after the first data fetch or when new lookups
    // are introduced), causing the gridColumns useMemo below to produce new column
    // object references. MUI DataGrid's GridFilterInputSingleSelect then sees a new
    // resolvedColumn and re-evaluates its memoized currentValueOptions with the fresh
    // lookup data, ensuring header-filter selections are applied correctly.
    const lookupKeys = useMemo(() => {
        const lookups = data?.lookups || {};
        return Object.keys(lookups).sort().join(',');
    }, [data?.lookups]);

    const { gridColumns, pinnedColumns, lookupMap } = useMemo(() => {
        let baseColumnList = columns || model.gridColumns || model.columns;
        if (dynamicColumns) {
            baseColumnList = [...dynamicColumns, ...baseColumnList];
        }
        const pinnedColumns = { left: [GRID_CHECKBOX_SELECTION_COL_DEF.field], right: [] };
        const finalColumns = [];
        const lookupMap = {};
        const updatedColumnType = { ...gridColumnTypes, ...model.gridColumnTypes };
        for (const column of baseColumnList) {
            if (column.gridLabel === null || (parent && column.lookup === parent) || (column.type === constants.oneToMany && column.countInList === false)) continue;
            const overrides = {};
            if (column.type === constants.oneToMany) {
                overrides.type = 'number';
                overrides.field = column.field.replace(/s$/, 'Count');
            }

            if (updatedColumnType[column.type]) {
                Object.assign(overrides, updatedColumnType[column.type]);
            }
            // Common filter operator pattern
            if (overrides.valueOptions === constants.lookup) {
                overrides.valueOptions = (params) => lookupOptions({ ...params, lookupMap });
            }
            if (column.linkTo || column.link) {
                overrides.cellClassName = 'mui-grid-linkColumn';
            }

            if (column.hyperlinkURL && !column.renderCell) {
                const { hyperlinkURL, hyperlinkIndex } = column;
                overrides.renderCell = (params) => {
                    const { value, formattedValue, row } = params;
                    if (value === null || value === undefined || value === '') return value;
                    const urlValue = hyperlinkIndex ? row[hyperlinkIndex] : value;
                    const hyperlink = hyperlinkURL.replace('{0}', encodeURIComponent(String(urlValue)));
                    return <a href={hyperlink} rel="noopener noreferrer" target="_blank">{formattedValue ?? value}</a>;
                };
            }

            if (!disableRowGrouping) {
                overrides.groupable = column.groupable ?? false;
            }
            const headerName = tTranslate((typeof column.gridLabel === 'function' ? column.gridLabel({ column, t: tTranslate, tOpts }) : column.gridLabel) || column.label, tOpts);

            finalColumns.push({ ...column, ...overrides, headerName, description: headerName });
            if (column.pinned) {
                pinnedColumns[column.pinned === constants.right ? constants.right : constants.left].push(column.field);
            }
            lookupMap[column.field] = column;
        }
        let auditColumns = model.standard;
        if (auditColumns === true) {
            auditColumns = { addCreatedOnColumn: true, addCreatedByColumn: true, addModifiedOnColumn: true, addModifiedByColumn: true };
        }
        if (auditColumns && typeof auditColumns === constants.object) {
            auditColumnMappings.forEach(({ key, field, type, header }) => {
                if (auditColumns[key] === true) {
                    const column = { field, type, headerName: tTranslate(header, tOpts), width: 200 };
                    // Apply shared grid column type overrides (renderers, valueOptions, etc.)
                    if (updatedColumnType && updatedColumnType[column.type]) {
                        Object.assign(column, updatedColumnType[column.type]);
                    }
                    if (type === constants.dateTime) {
                        column.filterOperators = LocalizedDatePicker({ columnType: 'dateTime' });
                        column.valueFormatter = gridColumnTypes.dateTime.valueFormatter;
                        column.localize = true;
                    }
                    finalColumns.push(column);
                }
            });
        }
        if (actionConfig.length) {
            finalColumns.push({
                field: 'actions',
                type: 'actions',
                width: (model.actionWidth ?? constants.defaultActionWidth) * actionConfig.length,
                hidable: false,
                getActions,
                headerName: tTranslate('Actions', tOpts),
            });

            pinnedColumns.right.push('actions');
        }
        return { gridColumns: finalColumns, pinnedColumns, lookupMap };
    }, [columns, model, parent, permissions, forAssignment, dynamicColumns, translate, stateData?.dateTime, lookupKeys]);

    // Initialize toolbar filters with default values
    const hasInitializedRef = useRef(false);
    useEffect(() => {
        // Only run once on initial mount
        if (hasInitializedRef.current) return;
        const toolbarFilterColumns = gridColumns?.filter(col => col.toolbarFilter?.defaultFilterValue !== undefined) || [];
        if (toolbarFilterColumns.length === 0) return;

        // Check if any toolbar filters already exist in filterModel
        const hasExistingToolbarFilters = filterModel.items.some(item =>
            toolbarFilterColumns.some(col => col.field === item.field)
        );
        if (hasExistingToolbarFilters) {
            hasInitializedRef.current = true;
            return;
        }

        const toolbarFilters = toolbarFilterColumns.map(col => {
            const operator = getDefaultOperator(col.type, col.toolbarFilter?.defaultOperator);
            const normalizedValue = utils.normalizeFilterValue({
                operator,
                value: col.toolbarFilter.defaultFilterValue
            });
            return {
                field: col.field,
                operator,
                value: normalizedValue,
                type: col.type
            };
        }).filter(f => {
            // Skip inserting toolbar filters where normalization produced an empty array,
            // which historically could result from legacy multi-select defaults (''/null).
            // An empty array often behaves like 'match none', so avoid adding it.
            const v = f.value;
            return !(Array.isArray(v) && v.length === 0);
        });

        if (toolbarFilters.length > 0) {
            setFilterModel(prev => ({
                ...prev,
                items: [...prev.items, ...toolbarFilters]
            }));
        }
        hasInitializedRef.current = true;
    }, [gridColumns]);


    const fetchData = useCallback(async ({ action = "list", extraParams = {}, isPivotExport = false, contentType, columns } = {}) => {
        if (hasStaticData) {
            if (!contentType) {
                setData(normalizedStaticData);
            }
            return;
        }
        const { pageSize, page } = paginationModelForFetch;
        const isExportRequest = Boolean(contentType);

        const baseUrl = buildUrl(isPivotExport ? model.pivotApi : backendApi);

        const filters = {
            ...filterModelForFetch,
            items: filterValidItems(filterModelForFetch.items)
        };
        const finalBaseFilters = Array.isArray(baseFilters) ? [...baseFilters] : [];
        if (model.joinColumn && id) {
            finalBaseFilters.push({ field: model.joinColumn, operator: "is", type: "number", value: Number(id) });
        }

        if (additionalFilters) {
            filters.items = [...(filters.items || []), ...additionalFilters];
        }

        // Merge parentFilters and baseFilters into one parameter
        const mergedBaseFilters = [];
        if (Array.isArray(finalBaseFilters)) {
            mergedBaseFilters.push(...finalBaseFilters);
        }
        if (Array.isArray(parentFilters)) {
            mergedBaseFilters.push(...parentFilters);
        }

        // Prepare extraParams with template and configFileName for pivot exports
        const mergedExtraParams = {
            ...extraParams,
            ...props.extraParams, // Merge any custom params passed via component props
        };

        if (assigned || available) {
            mergedExtraParams[assigned ? "include" : "exclude"] = Array.isArray(selected) ? selected.join(",") : selected;
        }

        // Add template and configFileName for pivot exports
        if (isPivotExport) {
            if (model.exportTemplate) {
                mergedExtraParams.template = model.exportTemplate;
            }
            if (model.configFileName) {
                mergedExtraParams.configFileName = model.configFileName;
            }
        }

        const isValidFilters = !filters.items.length || filters.items.every(item => "value" in item && item.value !== undefined);
        if (!isValidFilters) return;

        let signal = null;
        let controller = null;
        if (!isExportRequest) {
            if (fetchAbortControllerRef.current) {
                fetchAbortControllerRef.current.abort();
            }
            controller = new AbortController();
            fetchAbortControllerRef.current = controller;
            signal = controller.signal;
        }

        const listParams = {
            action,
            page: isExportRequest ? exportPage : page,
            pageSize: isExportRequest ? exportPageSize : pageSize,
            sortModel: sortModelForFetch,
            filterModel: filters,
            gridColumns,
            model,
            baseFilters: mergedBaseFilters,
            api: baseUrl,
            extraParams: mergedExtraParams
        };
        if (typeof onListParamsChange === 'function') {
            onListParamsChange(listParams);
        }
        apiRef.current.listParams = listParams;
        if (!isExportRequest) setIsLoading(true);
        try {
            const result = await getList({ ...listParams, contentType, columns, signal });
            if (!isExportRequest && result !== undefined && fetchAbortControllerRef.current === controller) {
                if (result?.aborted) return;
                setData(result);
            }
        } catch (error) {
            if (error?.aborted || error?.name === 'AbortError' || controller?.signal?.aborted) return;
            snackbar.showError(tTranslate('An error occurred while fetching data', tOpts));
            if (!isExportRequest) {
                setData((prevData) => ({ ...prevData, records: [], recordCount: 0 }));
            }
        } finally {
            if (!isExportRequest && fetchAbortControllerRef.current === controller) setIsLoading(false);
        }
    }, [hasStaticData, normalizedStaticData, paginationModelForFetch, buildUrl, model, backendApi, filterModelForFetch, baseFilters, id, assigned, available, selected, props.extraParams, sortModelForFetch, gridColumns, parentFilters, onListParamsChange, apiRef, getList, snackbar, additionalFilters, tTranslate, tOpts]);

    const openForm = useCallback(async ({ id, record = {}, mode }) => {
        if (setActiveRecord) {
            if (isStaticDataWithoutBackendApi) {
                snackbar.showError(backendApiRequiredMessage);
                return;
            }
            try {
                const baseUrl = buildUrl(backendApi);
                const data = await getRecord({ id, api: baseUrl, model, parentFilters, where });
                setActiveRecord(data);
            } catch (error) {
                snackbar.showError(tTranslate('Could not load record', tOpts));
            }
            return;
        }
        let path = pathname;
        if (!path.endsWith("/")) {
            path += "/";
        }
        if (mode === "copy") {
            path += "0-" + id;
        } else {
            path += id;
        }
        if (addUrlParamKey) {
            searchParams.set(addUrlParamKey, record[addUrlParamKey]);
            path += `?${searchParams.toString()}`;
        }
        navigate(path);
    }, [setActiveRecord, isStaticDataWithoutBackendApi, backendApi, backendApiRequiredMessage, model, parentFilters, where, pathname, addUrlParamKey, searchParams, navigate, getRecord, buildUrl, snackbar, tTranslate, tOpts]);

    const handleDownload = useCallback(({ documentLink }) => {
        if (!documentLink) return;
        window.open(documentLink, '_blank');
    }, []);
    const onCellClickHandler = useCallback(async (cellParams, event, details) => {
        let action = cellParams.field === model.linkColumn ? actionTypes.Edit : null;
        if (!action && cellParams.field === constants.actions) {
            action = details?.action;
            if (!action) {
                const el = event.target.closest('button');
                if (el) {
                    action = el.dataset.action;
                }
            }
        }
        const { row: record } = cellParams;
        if (!isReadOnly) {
            if (onCellClick) {
                const result = await onCellClick({ cellParams, event, details });
                if (typeof result !== constants.boolean) {
                    return;
                }
            }
            const columnConfig = lookupMap[cellParams.field] || {};
            if (columnConfig.linkTo) {
                navigate({
                    pathname: template.replaceTags(columnConfig.linkTo, record)
                });
                return;
            }
            switch (action) {
                case actionTypes.Edit: {
                    if (model.getDetailPanelContent) {
                        const rowId = record[idProperty];
                        setRowPanelId(prevId => prevId === rowId ? null : rowId);
                        return;
                    } else {
                        return openForm({ id: record[idProperty], record });
                    }
                }
                case actionTypes.Copy:
                    return openForm({ id: record[idProperty], mode: 'copy' });
                case actionTypes.Delete:
                    setIsDeleting(true);
                    setRecord({ name: record[model.linkColumn], id: record[idProperty] });
                    break;
                case actionTypes.History:
                    // navigates to history screen, specifying the tablename, id of record and breadcrumb to render title on history screen.
                    return navigate(`${getApiEndpoint('history')}?tableName=${tableName}&id=${record[idProperty]}&breadCrumb=${searchParamKey ? searchParams.get(searchParamKey) : gridTitle}`);
                default:
                    // Check if action matches any customAction and call its onClick if found
                    const foundCustomAction = customActions.find(ca => ca.action === action && typeof ca.onClick === constants.function);
                    if (foundCustomAction) {
                        foundCustomAction.onClick({ row: record, navigate });
                        return;
                    }
                    break;
            }
        }
        if (action === actionTypes.Download) {
            handleDownload({ documentLink: record[documentField] });
        }
        if (!toLink.length) {
            return;
        }
        const { row } = cellParams;
        const columnConfig = lookupMap[cellParams.field] || {};
        const historyObject = {
            pathname: template.replaceTags(columnConfig.linkTo, row)
        };
        if (model.addRecordToState) {
            historyObject.state = row;
        }
        navigate(historyObject);
    }, [isReadOnly, onCellClick, lookupMap, model, idProperty, documentField, navigate, toLink, customActions, tableName, searchParamKey, searchParams, gridTitle, getApiEndpoint, handleDownload, openForm]);

    const handleDelete = useCallback(async () => {
        if (isStaticDataWithoutBackendApi) {
            snackbar.showError(backendApiRequiredMessage);
            return;
        }
        const baseUrl = buildUrl(backendApi);
        try {
            await deleteRecord({ id: record.id, api: baseUrl, model });
            snackbar.showMessage(tTranslate('Record Deleted Successfully.', tOpts));
            fetchData();
        } catch (error) {
            snackbar.showError(tTranslate('Delete failed', tOpts), error.message);
        } finally {
            setIsDeleting(false);
        }
    }, [isStaticDataWithoutBackendApi, backendApiRequiredMessage, backendApi, record?.id, snackbar, model, fetchData, tTranslate, tOpts]);

    const clearError = useCallback(() => {
        setErrorMessage(null);
        setIsDeleting(false);
    }, []);

    const processRowUpdate = useCallback((updatedRow) => {
        if (typeof props.processRowUpdate === "function") {
            props.processRowUpdate(updatedRow, data);
        }
        return updatedRow;
    }, [props.processRowUpdate, data]);

    const onCellDoubleClick = useCallback((event) => {
        if (event.row.canEdit === false) {
            return;
        }
        const { row: record } = event;
        if (typeof onCellDoubleClickOverride === constants.function) {
            onCellDoubleClickOverride(event);
            return;
        }
        if (!isReadOnly && !isDoubleClicked && !disableCellRedirect) {
            openForm({ id: record[idProperty], record });
        }
        if (isReadOnly && model.rowRedirectLink) {
            const historyObject = {
                pathname: template.replaceTags(model.rowRedirectLink, record)
            };
            if (model.addRecordToState) {
                historyObject.state = record;
            }
            navigate(historyObject);
        }
        if (typeof onRowDoubleClick === constants.function) {
            onRowDoubleClick(event);
        }
    }, [onCellDoubleClickOverride, isReadOnly, isDoubleClicked, disableCellRedirect, openForm, idProperty, model.rowRedirectLink, model.addRecordToState, navigate, onRowDoubleClick, template]);

    const handleAddRecords = useCallback(async () => {
        if (rowSelectionModel.ids.size < 1) {
            snackbar.showError(tTranslate("Please select at least one record to proceed", tOpts));
            return;
        }

        const selectedIds = Array.from(rowSelectionModel.ids);
        const recordMap = new Map((data.records || []).map(record => [record[idProperty], record]));
        let selectedRecords = selectedIds.map(id => ({ ...baseSaveData, ...recordMap.get(id) }));

        // If selectionUpdateKeys is defined, filter each record to only those keys
        if (Array.isArray(model.selectionUpdateKeys) && model.selectionUpdateKeys.length) {
            selectedRecords = selectedRecords.map(item =>
                Object.fromEntries(model.selectionUpdateKeys.map(key => [key, item[key]]))
            );
        }

        const apiEndpoint = selectionApi || backendApi;
        if (!apiEndpoint) {
            snackbar.showError(backendApiRequiredMessage);
            return;
        }
        const baseUrl = buildUrl(apiEndpoint);
        setIsLoading(true);
        try {
            const result = await saveRecord({
                id: 0,
                api: `${baseUrl}/updateMany`,
                values: { items: selectedRecords },
                model
            });

            if (result) {
                fetchData();
                const message = result.info ? result.info : tTranslate('Record Added Successfully.', tOpts);
                snackbar.showMessage(message);
            }
        } catch (err) {
            snackbar.showError(err.message || tTranslate('An error occurred, please try after some time.', tOpts));
        } finally {
            setIsLoading(false);
            setRowSelectionModel({
                type: 'include',
                ids: new Set()
            });
            setShowAddConfirmation(false);
        }
    }, [rowSelectionModel.ids, snackbar, backendApiRequiredMessage, data.records, idProperty, baseSaveData, model.selectionUpdateKeys, selectionApi, backendApi, model, fetchData, tTranslate, tOpts]);

    const onAdd = useCallback(() => {
        if (selectionApi.length > 0) {
            if (rowSelectionModel.ids.size > 0) {
                setShowAddConfirmation(true);
                return;
            }
            snackbar.showError(
                tTranslate("Please select at least one record to proceed", tOpts),
            );
            return;
        }
        if (typeof onAddOverride === constants.function) {
            onAddOverride();
        } else {
            openForm({ id: 0 });
        }
    }, [selectionApi, snackbar, onAddOverride, openForm, rowSelectionModel.ids.size, tTranslate, tOpts]);

    const clearFilters = useCallback(() => {
        if (!filterModel?.items?.length) return;
        setFilterModel({ ...constants.gridFilterModel });
    }, [filterModel]);
    const updateAssignment = useCallback(({ unassign, assign }) => {
        const assignedValues = Array.isArray(selected) ? selected : (selected.length ? selected.split(',') : []);
        const finalValues = unassign ? assignedValues.filter(id => !unassign.includes(parseInt(id))) : [...assignedValues, ...assign];
        onAssignChange(typeof selected === constants.string ? finalValues.join(',') : finalValues);
    }, [selected, onAssignChange]);

    const onAssign = useCallback(() => {
        updateAssignment({ assign: Array.from(rowSelectionModel.ids) });
    }, [updateAssignment, rowSelectionModel.ids]);

    const onUnassign = useCallback(() => {
        updateAssignment({ unassign: Array.from(rowSelectionModel.ids) });
    }, [updateAssignment, rowSelectionModel.ids]);

    const selectAll = useCallback(() => {
        const records = data.records || [];
        const currentCount = rowSelectionModel.ids.size;
        if (currentCount === records.length) {
            // If all records are selected, deselect all
            setRowSelectionModel({
                type: 'include',
                ids: new Set()
            });
        } else {
            // Select all records
            const allIds = records.map(record => record[idProperty]);
            setRowSelectionModel({
                type: 'include',
                ids: new Set(allIds)
            });
        }
    }, [rowSelectionModel, data.records, idProperty]);

    const getGridRowId = useCallback((row) => row[idProperty], [idProperty]);
    const handleExport = useCallback((e) => {
        const contentType = e.currentTarget?.dataset?.contentType || e.target?.dataset?.contentType;
        const isPivotExport = (e.currentTarget?.dataset?.isPivotExport || e.target?.dataset?.isPivotExport) === 'true';
        if (hasStaticData || localSortAndFilter) {
            if (contentType === 'text/csv') {
                apiRef.current?.exportDataAsCsv?.();
                return;
            }
            if (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
                apiRef.current?.exportDataAsExcel?.();
                return;
            }
            return;
        }
        if (data?.recordCount > recordCounts) {
            snackbar.showMessage(tTranslate('Cannot export more than 60k records, please apply filters or reduce your results using filters', tOpts));
            return;
        }
        const { orderedFields, columnVisibilityModel, lookup } = apiRef.current.state.columns;
        const hiddenColumns = Object.keys(columnVisibilityModel).filter(key => columnVisibilityModel[key] === false);

        const nonExportColumns = new Set(gridColumns.filter(col => col.exportable === false).map(col => col.field));

        const visibleColumns = orderedFields.filter(
            field => !nonExportColumns.has(field) && !hiddenColumns.includes(field) && field !== '__check__' && field !== 'actions'
        );

        if (visibleColumns.length === 0) {
            snackbar.showMessage(tTranslate('You cannot export while all columns are hidden... please show at least 1 column before exporting', tOpts));
            return;
        }

        const columns = {};
        const gridColsLookup = Object.fromEntries(gridColumns.map(c => [c.field, c]));
        visibleColumns.forEach(field => {
            const col = lookup[field];
            const gridCol = gridColsLookup[field];
            columns[field] = {
                field,
                width: col.width,
                headerName: gridCol?.headerName || col.headerName || col.field,
                type: col.type,
                isParsable: col.isParsable,
                lookup: col.lookup,
                hyperlinkURL: col.hyperlinkURL,
                hyperlinkIndex: col.hyperlinkIndex,
                localize: col.localize,
                exportIndex: col.exportIndex
            };
        });
        const action = (model?.formActions?.export || isPivotExport) ? (model?.formActions?.export || 'export') : undefined;
        fetchData({
            action,
            isPivotExport,
            contentType,
            columns
        });
    }, [hasStaticData, localSortAndFilter, data?.recordCount, apiRef, gridColumns, snackbar, model, fetchData, tTranslate, tOpts]);

    useEffect(() => {
        if ((!backendApi && !hasStaticData) || !preferencesReady) return;
        fetchData();
    }, [backendApi, hasStaticData, preferencesReady, fetchData]);

    useEffect(() => {
        if (props.isChildGrid || forAssignment || !updatePageTitle) {
            return;
        }
        setPageTitle({ icon: "", titleHeading: model.pageTitle || model.title, title: model.title });
        return () => {
            setPageTitle(null);
        };
    }, [setPageTitle, model.pageTitle, model.title, props.isChildGrid, forAssignment, updatePageTitle]);

    const updateFilters = useCallback((e) => {
        const { items } = e;
        const updatedItems = items.map(item => {
            const { field, operator, value } = item;
            const column = gridColumns.find(col => col.field === field) || {};
            const isNumber = column.type === constants.Number;

            // Handle operators that do not require a value
            if (NO_VALUE_OPERATORS.includes(operator)) {
                return { ...item, value: null };
            }

            if (isNumber && value < 0) {
                return { ...item, value: null };
            }

            if ((emptyIsAnyOfOperatorFilters.includes(operator)) || (isNumber && !isNaN(value)) || (!isNumber)) {
                const isKeywordField = isElasticScreen && gridColumns.filter(element => element.field === field)[0]?.isKeywordField;
                if (isKeywordField) {
                    item.filterField = `${item.field}.keyword`;
                }
                return { ...item };
            }
            return { ...item, value: isNumber ? null : value };
        });
        setFilterModel({ ...e, items: updatedItems });
    }, [gridColumns, constants.Number, emptyIsAnyOfOperatorFilters, isElasticScreen, setFilterModel]);

    const updateSort = useCallback((e) => {
        if (e[0]) {
            if (gridGroupByColumnName.includes(e[0].field)) {
                snackbar.showMessage(tTranslate('Group By is applied on the same column, please remove it in order to apply sorting.', tOpts));
                return;
            }
        }
        const sort = e.map((ele) => {
            const field = gridColumns.filter(element => element.field === ele.field)[0] || {};
            const isKeywordField = isElasticScreen && field.isKeywordField;
            const obj = { ...ele, filterField: isKeywordField ? `${ele.field}.keyword` : ele.field };
            if (field.dataIndex) {
                obj.filterField = field.dataIndex;
            }
            return obj;
        });
        setSortModel(sort);
    }, [gridColumns, isElasticScreen, setSortModel]);

    const pageTitle = title || model.gridTitle || model.title;
    const breadCrumbs = searchParamKey
        ? [{ text: searchParams.get(searchParamKey) || pageTitle }]
        : [{ text: pageTitle }];

    const handleDetailPanelExpanded = useCallback((ids) => {
        setRowPanelId(ids.size > 0 ? [...ids].pop() : null);
    }, []);

    const getDetailPanelContent = useCallback((params) => {
        if (typeof model.getDetailPanelContent === 'function') {
            return model.getDetailPanelContent({
                ...params,
                onRefresh: () => {
                    // Close the expanded panel and refresh data
                    setRowPanelId(null);
                    fetchData();
                },
                t: tTranslate,
                tOpts
            });
        }
        return null;
    }, [model.getDetailPanelContent, fetchData, tTranslate, tOpts]);

    const localeText =
        useMemo(() => ({
            filterValueTrue: tTranslate('Yes', tOpts),
            filterValueFalse: tTranslate('No', tOpts),
            noRowsLabel: tTranslate('No data', tOpts),
            footerTotalRows: `${tTranslate('Total rows', tOpts)}:`,
            MuiTablePagination: {
                labelRowsPerPage: tTranslate('Rows per page', tOpts),
                labelDisplayedRows: ({ from, to, count }) => `${from}–${to} ${tTranslate('of', tOpts)} ${count}`,
            },
            toolbarQuickFilterPlaceholder: tTranslate(model?.searchPlaceholder || 'Search...', tOpts),
            toolbarColumns: tTranslate('Columns', tOpts),
            toolbarFilters: tTranslate('Filters', tOpts),
            toolbarExport: tTranslate('Export', tOpts),
            filterPanelAddFilter: tTranslate('Add filter', tOpts),
            filterPanelRemoveAll: tTranslate('Remove all', tOpts),
            filterPanelDeleteIconLabel: tTranslate('Delete', tOpts),
            filterPanelColumns: tTranslate('Columns', tOpts),
            filterPanelOperator: tTranslate('Operator', tOpts),
            filterPanelValue: tTranslate('Value', tOpts),
            filterPanelInputLabel: tTranslate('Value', tOpts),
            filterPanelInputPlaceholder: tTranslate('Filter value', tOpts),
            columnMenuLabel: tTranslate('Menu', tOpts),
            columnMenuShowColumns: tTranslate('Show columns', tOpts),
            columnMenuManageColumns: tTranslate('Manage columns', tOpts),
            columnMenuFilter: tTranslate('Filter', tOpts),
            columnMenuHideColumn: tTranslate('Hide column', tOpts),
            columnMenuManagePivot: tTranslate('Manage pivot', tOpts),
            toolbarColumnsLabel: tTranslate('Select columns', tOpts),
            toolbarExportLabel: tTranslate('Export', tOpts),
            pivotDragToColumns: tTranslate('Drag here to pivot by', tOpts),
            pivotDragToRows: tTranslate('Drag here to group by', tOpts),
            pivotDragToValues: tTranslate('Drag here to create values', tOpts),
            pivotColumns: tTranslate('Pivot columns', tOpts),
            pivotRows: tTranslate('Row groups', tOpts),
            pivotValues: tTranslate('Values', tOpts),
            pivotMenuRows: tTranslate('Rows', tOpts),
            pivotMenuColumns: tTranslate('Columns', tOpts),
            pivotMenuValues: tTranslate('Values', tOpts),
            pivotToggleLabel: tTranslate('Pivot', tOpts),
            pivotSearchControlPlaceholder: tTranslate('Search pivot columns', tOpts),
            columnMenuUnsort: tTranslate('Unsort', tOpts),
            columnMenuSortAsc: tTranslate('Sort by ascending', tOpts),
            columnMenuSortDesc: tTranslate('Sort by descending', tOpts),
            columnMenuUnpin: tTranslate('Unpin', tOpts),
            columnsPanelTextFieldLabel: tTranslate('Find column', tOpts),
            columnsPanelTextFieldPlaceholder: tTranslate('Column title', tOpts),
            columnsPanelHideAllButton: tTranslate('Hide all', tOpts),
            columnsPanelShowAllButton: tTranslate('Show all', tOpts),
            pinToLeft: tTranslate('Pin to left', tOpts),
            pinToRight: tTranslate('Pin to right', tOpts),
            unpin: tTranslate('Unpin', tOpts),
            filterValueAny: tTranslate('any', tOpts),
            filterOperatorIs: tTranslate('is', tOpts),
            filterOperatorNot: tTranslate('is not', tOpts),
            filterOperatorIsAnyOf: tTranslate('is any of', tOpts),
            filterOperatorContains: tTranslate('contains', tOpts),
            filterOperatorDoesNotContain: tTranslate('does not contain', tOpts),
            filterOperatorEquals: tTranslate('equals', tOpts),
            filterOperatorDoesNotEqual: tTranslate('does not equal', tOpts),
            filterOperatorStartsWith: tTranslate('starts with', tOpts),
            filterOperatorEndsWith: tTranslate('ends with', tOpts),
            filterOperatorIsEmpty: tTranslate('is empty', tOpts),
            filterOperatorIsNotEmpty: tTranslate('is not empty', tOpts),
            filterOperatorAfter: tTranslate('is after', tOpts),
            filterOperatorOnOrAfter: tTranslate('is on or after', tOpts),
            filterOperatorBefore: tTranslate('is before', tOpts),
            filterOperatorOnOrBefore: tTranslate('is on or before', tOpts),
            toolbarFiltersTooltipHide: tTranslate('Hide filters', tOpts),
            toolbarFiltersTooltipShow: tTranslate('Show filters', tOpts),

            //filter textfield labels
            headerFilterOperatorContains: tTranslate('contains', tOpts),
            headerFilterOperatorEquals: tTranslate('equals', tOpts),
            headerFilterOperatorStartsWith: tTranslate('starts with', tOpts),
            headerFilterOperatorEndsWith: tTranslate('ends with', tOpts),
            headerFilterOperatorIsEmpty: tTranslate('is empty', tOpts),
            headerFilterOperatorIsNotEmpty: tTranslate('is not empty', tOpts),
            headerFilterOperatorAfter: tTranslate('is after', tOpts),
            headerFilterOperatorOnOrAfter: tTranslate('is on or after', tOpts),
            headerFilterOperatorBefore: tTranslate('is before', tOpts),
            headerFilterOperatorOnOrBefore: tTranslate('is on or before', tOpts),
            headerFilterOperatorIs: tTranslate('is', tOpts),
            'headerFilterOperator=': tTranslate('equals', tOpts),
            'headerFilterOperator!=': tTranslate('does not equal', tOpts),
            'headerFilterOperator>': tTranslate('greater than', tOpts),
            'headerFilterOperator>=': tTranslate('greater than or equal to', tOpts),
            'headerFilterOperator<': tTranslate('less than', tOpts),
            'headerFilterOperator<=': tTranslate('less than or equal to', tOpts),
            columnsManagementSearchTitle: tTranslate('Search', tOpts),
            columnsManagementNoColumns: tTranslate('No columns', tOpts),
            paginationRowsPerPage: tTranslate('Rows per page', tOpts),
            paginationDisplayedRows: ({ from, to, count }) => `${from}–${to} ${tTranslate('of', tOpts)} ${count}`,
            toolbarQuickFilterLabel: tTranslate('Search', tOpts),
            toolbarFiltersTooltipActive: (count) => {
                const key = count === 1 ? 'active filter' : 'active filters';
                return `${count} ${tTranslate(key, tOpts)}`;
            },
            columnHeaderSortIconLabel: tTranslate('Sort', tOpts),
            filterPanelOperatorAnd: tTranslate('And', tOpts),
            filterPanelOperatorOr: tTranslate('Or', tOpts),
            noResultsOverlayLabel: tTranslate('No results found', tOpts),
            columnHeaderFiltersTooltipActive: (count) => {
                const key = count === 1 ? 'active filter' : 'active filters';
                return `${count} ${tTranslate(key, tOpts)}`;
            },
            detailPanelToggle: tTranslate('Detail panel toggle', tOpts),
            checkboxSelectionHeaderName: tTranslate('Checkbox selection', tOpts),
            columnsManagementShowHideAllText: tTranslate('Show/Hide all', tOpts),
            noColumnsOverlayLabel: tTranslate('No columns', tOpts),
            noColumnsOverlayManageColumns: tTranslate('Manage columns', tOpts),
            columnsManagementReset: tTranslate('Reset', tOpts),
            groupColumn: (name) => `${tTranslate('Group by', tOpts)} ${name}`,
            unGroupColumn: (name) => `${tTranslate('Ungroup', tOpts)} ${name}`,
            footerRowSelected: (count) => {
                const key = count === 1 ? 'item selected' : 'items selected';
                return `${count.toLocaleString()} ${tTranslate(key, tOpts)}`;
            }
        }), [tTranslate, tOpts, model?.searchPlaceholder]);

    const slotProps = useMemo(() => ({
        headerFilterCell: { showClearIcon: true },
        toolbar: {
            model,
            data,
            currentPreference,
            isReadOnly,
            canAdd,
            forAssignment,
            showAddIcon,
            onAdd,
            selectionApi,
            rowSelectionModel,
            selectAll,
            available,
            onAssign,
            assigned,
            onUnassign,
            effectivePermissions,
            clearFilters,
            handleExport,
            preferenceKey,
            apiRef,
            gridColumns,
            tTranslate,
            tOpts,
            idProperty,
            filterModel,
            setFilterModel,
            onPreferenceChange,
            toolbarItems,
            headerActions: props.headerActions,
            customExportOptions,
            isStaticDataMode: hasStaticData || localSortAndFilter
        },
        footer: {
            pagination: disablePagination !== true,
            apiRef,
            tTranslate,
            tOpts
        },
        panel: {
            placement: "bottom-end"
        },
        pagination: {
            backIconButtonProps: {
                title: tTranslate('Go to previous page', tOpts),
                'aria-label': tTranslate('Go to previous page', tOpts),
            },
            nextIconButtonProps: {
                title: tTranslate('Go to next page', tOpts),
                'aria-label': tTranslate('Go to next page', tOpts),
            },
        }
    }), [model, data, currentPreference, isReadOnly, canAdd, forAssignment, showAddIcon, onAdd, selectionApi, rowSelectionModel, selectAll, available, onAssign, assigned, onUnassign, effectivePermissions, clearFilters, handleExport, preferenceKey, apiRef, gridColumns, tTranslate, tOpts, idProperty, filterModel, setFilterModel, onPreferenceChange, toolbarItems, props.headerActions, customExportOptions, hasStaticData]);

    const initialState = useMemo(() => ({
        columns: {
            columnVisibilityModel: visibilityModel
        },
        pinnedColumns: pinnedColumns
    }), [visibilityModel, pinnedColumns]);

    const slots = useMemo(() => ({
        headerFilterMenu: false,
        toolbar: CustomToolbar,
        footer: Footer
    }), []);

    return (
        <>
            {showPageTitle !== false && <PageTitle navigate={navigate} showBreadcrumbs={!hideBreadcrumb && !hideBreadcrumbInGrid}
                breadcrumbs={breadCrumbs} enableBackButton={navigateBack} breadcrumbColor={breadcrumbColor} model={model} />}
            <Box style={gridStyle || customStyle}>
                <Box sx={{ display: 'flex', maxHeight: '80vh', flexDirection: 'column' }}>
                    <DataGridPremium
                        sx={[
                            {
                                "& .MuiTablePagination-selectLabel": {
                                    marginTop: 2
                                },
                                "& .MuiTablePagination-displayedRows": {
                                    marginTop: 2
                                },
                                "& .MuiDataGrid-virtualScroller ": {
                                    zIndex: 2
                                },
                                "& .MuiDataGrid-detailPanelToggleCell, & .MuiDataGrid-cell--withRenderer.MuiDataGrid-cell--detailPanelToggle": {
                                    display: 'none'
                                },
                            },
                            ...(Array.isArray(propsSx) ? propsSx : propsSx ? [propsSx] : [])
                        ]}
                        headerFilters={showHeaderFilters}
                        unstable_headerFilters={showHeaderFilters} //for older versions of mui
                        checkboxSelection={forAssignment}
                        loading={!data.records || isLoading}
                        className="pagination-fix"
                        onCellClick={onCellClickHandler}
                        onCellDoubleClick={onCellDoubleClick}
                        columns={gridColumns}
                        paginationModel={paginationModel}
                        pageSizeOptions={constants.pageSizeOptions}
                        onPaginationModelChange={setPaginationModel}
                        pagination={!disablePagination}
                        rowCount={data.recordCount}
                        rows={data.records || []}
                        sortModel={sortModel}
                        paginationMode={paginationMode}
                        sortingMode={sortAndFilterMode}
                        filterMode={sortAndFilterMode}
                        processRowUpdate={processRowUpdate}
                        keepNonExistentRowsSelected
                        onSortModelChange={updateSort}
                        onFilterModelChange={updateFilters}
                        rowSelectionModel={rowSelectionModel}
                        onRowSelectionModelChange={setRowSelectionModel}
                        filterModel={filterModel}
                        getRowId={getGridRowId}
                        onRowClick={onRowClick}
                        slots={slots}
                        slotProps={slotProps}
                        hideFooterSelectedRowCount={rowsSelected}
                        density="compact"
                        disableDensitySelector={true}
                        apiRef={apiRef}
                        disableAggregation={true}
                        disableRowGrouping={disableRowGrouping}
                        disableRowSelectionOnClick={disableRowSelectionOnClick}
                        disablePivoting={disablePivoting}
                        filterDebounceMs={debounceTimeOut}
                        initialState={initialState}
                        {...(enableRowDetailPanel && {
                            getDetailPanelContent,
                            detailPanelExpandedRowIds,
                            onDetailPanelExpandedRowIdsChange: handleDetailPanelExpanded
                        })}
                        localeText={localeText}
                        showToolbar={true}
                        columnHeaderHeight={columnHeaderHeight}
                        hideFooter={!showFooter}
                        rowGroupingModel={groupingModel}
                        onRowGroupingModelChange={(newGroupingModel) => setGroupingModel(newGroupingModel)}
                        getRowClassName={props.getRowClassName}
                        columnGroupingModel={columnGroupingModel}
                    />
                </Box>
                {errorMessage && (<DialogComponent open={!!errorMessage} onConfirm={clearError} onCancel={clearError} title="Info" hideCancelButton={true} > {errorMessage}</DialogComponent>)
                }
                {isDeleting && !errorMessage && (
                    <DialogComponent open={isDeleting} onConfirm={handleDelete} onCancel={() => setIsDeleting(false)} title={tTranslate("Confirm Delete", tOpts)} okText={tTranslate("Ok", tOpts)} cancelText={tTranslate("Cancel", tOpts)}>
                        <DeleteContentText>
                            {tTranslate("Are you sure you want to delete", tOpts)} {record.name && <Tooltip style={{ display: "inline" }} title={record.name} arrow>
                                {record.name.length > 30 ? `${record.name.slice(0, 30)}...` : record.name}
                            </Tooltip>} ?
                        </DeleteContentText>
                    </DialogComponent>)}
                {showAddConfirmation && (
                    <DialogComponent
                        open={showAddConfirmation}
                        onConfirm={handleAddRecords}
                        onCancel={() => setShowAddConfirmation(false)}
                        title={tTranslate("Confirm Add", tOpts)}
                        okText={tTranslate("Ok", tOpts)}
                        cancelText={tTranslate("Cancel", tOpts)}
                    >
                        <DeleteContentText>
                            {tTranslate("Are you sure you want to add", tOpts)} {rowSelectionModel.ids.size} {tTranslate("records", { count: rowSelectionModel.ids.size, ...tOpts })}?
                        </DeleteContentText>
                    </DialogComponent>
                )}
            </Box >
        </>
    );
}, areEqual);

export default GridBase;
