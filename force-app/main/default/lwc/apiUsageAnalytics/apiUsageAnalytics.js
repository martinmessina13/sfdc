import { LightningElement } from 'lwc';
import userSesion from "c/userSesion";
import GraphqlRepository from 'c/graphqlRepository';

const HYCU_PALETTE = ['rgba(239, 71, 111)', 'rgba(255, 209, 102)', 'rgba(6, 214, 160)', 'rgba(17, 138, 178)', 'rgba(7, 59, 76)', 'rgb(103, 148, 54)', 'rgb(165, 190, 0)'];

export default class ApiUsageAnalytics extends LightningElement {

    currentEmailAddress;
    fromDate;
    toDate;
    productMetrics;
    productKeyMetrics;
    period;
    
    daysDifference;
    weeksDifference;
    monthsDifference;

    axisLabels;

    fromDateStartWeek;
    fromDateStartMonth;
    
    apiCallsMap = new Map();
    apisMap = new Map();
    
    apiData = [];

    isLoading = true;

    async connectedCallback(){
        if(!this.fromDate){
            let begginningMonth = this.getDay(new Date(), true);
            this.fromDate = begginningMonth.toISOString().slice(0, 10);
        }
        if(!this.toDate){
            let today = this.getDay(new Date(), false);
            this.toDate = today.toISOString().slice(0, 10);
        }

        await this.getCurrentEmailAddress();
        await this.fetchAndSetData();
        this.isLoading = false;
    }

    getDay(date, beginningMonth){
        if(beginningMonth) {
            date.setDate(1);
        }
        date.setHours(0, 0, 0, 0);
        return date;
    }

    async getCurrentEmailAddress(){
        const salesforceUser = await userSesion.getCurrentSalesforceUser();
        this.currentEmailAddress = salesforceUser.Email;
    }

    async getMetrics(interval){
        let email = this.currentEmailAddress;
        let fromDate = this.getEpochFromISOString(this.fromDate);
        let toDate = this.getEpochFromISOString(this.toDate);
        let graphqlQuery = GraphqlRepository.invokeMetricsQuery(email, fromDate, toDate + 24 * 3600 * 1000, interval);
        let fetchedMetrics = await GraphqlRepository.executeQuery(graphqlQuery);
        return fetchedMetrics.productKeysWithFilters;
    }

    getEpochFromISOString(isoString){
        return new Date(isoString).getTime();
    }

    getInterval(){
        let toDate = this.getEpochFromISOString(this.toDate);
        toDate = toDate + (1000 * 3600 * 24); // Including both ends in date interval
        this.fromDateStartDay = this.getEpochFromISOString(this.fromDate);
        let fromDate = this.fromDateStartDay;
        this.daysDifference = this.getDayDifference(toDate, fromDate);
        if(this.daysDifference <= 14) {
            return 'days';
        }
        else{
            toDate = new Date(toDate - (1000 * 3600 * 24));
            fromDate = new Date(fromDate);
            
            this.monthsDifference = this.getMonthDifference(toDate, fromDate);
            this.fromDateStartMonth = this.getFirstDayOfMonth(fromDate);

            if(this.monthsDifference < 6){
                toDate = this.getFirstDayOfWeek(toDate); // adding a week to include the end of the interval
                toDate = toDate + 24 * 3600 * 1000 * 7;
                this.fromDateStartWeek = this.getFirstDayOfWeek(fromDate);
                this.weeksDifference = this.getWeekDifference(toDate, this.fromDateStartWeek);
                return 'weeks';
            }
            else{
                return 'months';
            }
        }
    }

    async handleDateChange(event){
        let input = event.currentTarget.name;
        let date = event.detail.value;
        let dateEpoch = new Date(date).getTime();
        let oldToEpoch = new Date(this.toDate).getTime();
        let oldFromEpoch = new Date(this.fromDate).getTime();
        if((date != this.fromDate || date != this.toDate) && 
                (dateEpoch < oldToEpoch && input === 'from-date' 
                || dateEpoch > oldFromEpoch && input == 'to-date')){
            this.isLoading = true;
            this.apiData = [];
        }
        if(input === 'from-date'){
            if(date != this.fromDate && dateEpoch < oldToEpoch){
                this.fromDate = date;
            }
        }
        else if(input === 'to-date'){
            if(date != this.toDate && dateEpoch > oldFromEpoch){
                this.toDate = date;
            }
        }
        await this.fetchAndSetData();
        this.isLoading = false;
    }

    async fetchAndSetData(){
        let interval = this.getInterval();
        this.period = this.toCapsCase(interval);
        let productKeyMetrics = await this.getMetrics(interval);
        // The relevant product keys have a product associated with them
        productKeyMetrics = productKeyMetrics.filter(productKey => {
            return productKey.productMetrics.length && this.assetMetricsCallsCheck(productKey.assetMetrics);
        });

        this.setData(productKeyMetrics, interval);
    }

    setData(productKeyMetrics, interval){

        let apisMap = new Map();

        productKeyMetrics.forEach(metric => {
            // There's only one product associated with each product key
            let product = metric.productMetrics.find(pm => pm).product;
            let assets = metric.assetMetrics;
            assets.forEach(asset => {
                this.addAssetToMap(asset, product, apisMap);
            });
        });

        for(let asset of apisMap.values()){
            asset.calls = JSON.stringify(
                this.setDataArray(asset.calls, interval)
            );
        }

        let apiData = [...apisMap.values()];
        this.apiData = this.getApiColor(apiData);
        this.axisLabels = this.createPeriodArray(interval);
    }

    addAssetToMap(asset, product, apisMap){
        let assetId = asset.asset.id+product.id;

        let callsObject = {
            date: +asset.date,
            count: asset.totalCallCount,
        }

        if(!apisMap.has(assetId)){
            
            let assetObject = {
                id: assetId,
                label: `${asset.asset.name} (${product.name})`,
                calls: [
                    callsObject
                ],
                productId: product.id                
            };

            apisMap.set(assetId, assetObject);
        }
        else{
            apisMap.get(assetId).calls.push(callsObject);
        }
    }

    toCapsCase(string){
        return string[0].toUpperCase() + string.slice(1);
    }

    aggregateCalls(calls, periodCalls, interval){
        let fromDate;
        let index;

        if(interval === 'days'){
            fromDate = this.fromDateStartDay;
        }
        else if(interval === 'weeks'){
            fromDate = this.fromDateStartWeek;
        }
        else if(interval === 'months'){
            fromDate = this.fromDateStartMonth;
        }

        calls.forEach(call => {
            if(interval === 'days'){
                index = this.getDayDifference(call.date, fromDate);
            }
            else if(interval === 'weeks'){
                index = this.getWeekDifference(call.date, fromDate);
            }
            else if(interval === 'months'){
                index = this.getMonthDifference(call.date, fromDate);
            }
            periodCalls[index] += call.count;
        });

        return periodCalls;
    }

    createPeriodArray(interval){
        if(interval === 'days'){
            return JSON.stringify(this.createDatasetLabels(this.daysDifference, this.fromDateStartDay, interval));
        }
        else if(interval === 'weeks'){
            return JSON.stringify(this.createDatasetLabels(this.weeksDifference, this.fromDateStartWeek, interval));
        }
        else if(interval === 'months'){
            return JSON.stringify(this.createDatasetLabels(this.monthsDifference + 1, this.fromDateStartMonth, interval));
        }
    }

    createDatasetLabels(periodLength, startDate, interval){
        let datasetLabels;
        let dates = [...new Array(periodLength)].fill(startDate);
        datasetLabels = this.addConsecutiveDates(dates, interval);
        return datasetLabels;
    }

    addConsecutiveDates(dates, interval){
        let dateStrings;
        if(interval === 'days'){
            dateStrings = dates.map((date, i) => 
                {
                    return new Date(date + i * 24 * 3600 * 1000);
                }
            );
            return this.formatDates(dateStrings, interval);
        }
        else if(interval === 'weeks'){
            dateStrings = dates.map((date, i) => 
                {
                    return new Date(date + i * 7 * 24 * 3600 * 1000);
                }
            );
            return this.formatDates(dateStrings, interval);
        }
        else if(interval === 'months'){
            dateStrings = dates.map((date, i) => 
                {
                    let currentMonth = new Date(date);
                    let month = currentMonth.getUTCMonth(); 
                    return new Date(currentMonth.setUTCMonth(month + i));
                }
            );
            return this.formatDates(dateStrings, interval);
        }
    }

    formatDates(dateStrings, interval){
        if(interval === 'days'){
            return dateStrings.map(
                dateString => 
                    dateString.toUTCString().slice(5,11)
            );
        }
        else if(interval === 'weeks'){
            return dateStrings.map(
                dateString => 
                    {
                        let firstWeekDayStr = dateString.toUTCString().slice(5,16);
                        let lastWeekDay = new Date(dateString.getTime() + 6 * 24 * 3600 * 1000);
                        let lastWeekDayStr = lastWeekDay.toUTCString().slice(5,16);
                        return firstWeekDayStr + ' - ' + lastWeekDayStr;
                    }
            );
        }
        else if(interval === 'months'){
            return dateStrings.map(
                dateString => 
                    dateString.toUTCString().slice(8,16)
            );
        }
    }

    getDayDifference(toDate, fromDate){
        let difference = (toDate - fromDate) / 1000 / 3600 / 24;
        return Math.floor(difference);
    }

    getWeekDifference(toDate, fromDate){
        let difference = (toDate - fromDate) / 1000 / 3600 / 24 / 7;
        return Math.floor(difference);
    }

    getMonthDifference(toDate, fromDate){
        if(typeof toDate == 'number' && typeof fromDate == 'number' ){
            toDate = new Date(toDate);
            fromDate = new Date(fromDate);
        }
        let toDateYear = toDate.getUTCFullYear();
        let fromDateYear = fromDate.getUTCFullYear();

        let toDateMonth = toDate.getUTCMonth();
        let fromDateMonth = fromDate.getUTCMonth();

        let monthsExtra = (toDateYear - fromDateYear) * 12;

        return toDateMonth - fromDateMonth + monthsExtra;
    }

    getApiColor(assets){
        assets.forEach((asset, i) => {
            let cycleIndex = i < HYCU_PALETTE.length ? i : (i - HYCU_PALETTE.length) % HYCU_PALETTE.length;
            asset.colour = HYCU_PALETTE[cycleIndex];
        });
        return assets;
    }

    setDataArray(callsObj, interval){
        let periodCalls = this.createDataArray(interval);
        periodCalls = this.aggregateCalls(callsObj, periodCalls, interval);
        return periodCalls;
    }

    getFirstDayOfWeek(date){
        let day = date.getUTCDay();
        let diff = date.getUTCDate() - day + (day > 0 ? 1 : -6); // If sunday, substract 6 days of the week to get monday
        return new Date(date.setUTCDate(diff)).getTime();
    }

    getFirstDayOfMonth(date){
        return new Date(date.setUTCDate(1)).getTime();
    }

    createDataArray(interval){
        if(interval === 'days'){
            return new Array(this.daysDifference).fill(0);
        }
        else if(interval === 'weeks'){
            return new Array(this.weeksDifference).fill(0);
        }
        else if(interval === 'months'){
            return new Array(this.monthsDifference + 1).fill(0);
        }
    }

    assetMetricsCallsCheck(assetMetrics){
        for(let assetMetric of assetMetrics){
            if(assetMetric.totalCallCount > 0){
                return true;
            }
        }
        return false;
    }

    removeRepeatedValue(apiData){
        let newApiData = [];
        apiData.forEach(api => {
            if(!this.apisMap.has(api.id)){
                newApiData.push(api);
            }
        });
        this.populateGlobalMap(newApiData);
        return newApiData;
    }
    
    populateGlobalMap(apis){
        for(let api of apis){
            if(!this.apisMap.has(api.id)){
                this.apisMap.set(api.id, api);
            }
        }
    }
}