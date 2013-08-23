(function () {
    var Ext = window.Ext4 || window.Ext;

    Ext.define("Rally.apps.charts.burndown.BurnDownCalculator", {
        extend: "Rally.data.lookback.calculator.TimeSeriesCalculator",

        mixins: [
            "Rally.apps.charts.DateMixin"
        ],

        getDerivedFieldsOnInput: function () {
            var completedStates = this.config.completedScheduleStateNames,
                aggregationType = this.config.chartAggregationType;

            return [
                {
                    "as": "RemainingPoints",
                    "f": function (snapshot) {
                        var ss = snapshot.ScheduleState;
                        if(completedStates.indexOf(ss) < 0) {
                            if(aggregationType === "storycount") {
                                return 1;
                            } else if (snapshot.PlanEstimate) {
                                return snapshot.PlanEstimate;
                            }
                        }

                        return 0;
                    }
                },
                {
                    "as": "AcceptedPoints",
                    "f": function (snapshot) {
                        var ss = snapshot.ScheduleState;
                        if (completedStates.indexOf(ss) > -1) {
                            if (aggregationType === "storycount") {
                                return 1;
                            } else if (snapshot.PlanEstimate) {
                                return snapshot.PlanEstimate;
                            }
                        }

                        return 0;
                    }
                }
            ];
        },

        getMetrics: function () {
            return [
                {
                    "field": "RemainingPoints",
                    "as": "To Do",
                    "f": "sum"
                },
                {
                    "field": "AcceptedPoints",
                    "as": "Accepted",
                    "f": "sum"
                }
            ];
        },

        getSummaryMetricsConfig: function () {
            return [
                {
                    'as': 'Scope_max',
                    'f': function(seriesData) {
                            var max = 0, i = 0;
                            for (i=0;i<seriesData.length;i++) {
                                if(seriesData[i].Accepted + seriesData[i]['To Do'] > max) {
                                    max = seriesData[i].Accepted + seriesData[i]['To Do'];
                                }
                            }
                            return max;
                         }
                }
            ];
        },

        getDerivedFieldsAfterSummary: function () {
            return  [
                {
                    "as": "Ideal",
                    "f": function (row, index, summaryMetrics, seriesData) {
                        var max = summaryMetrics.Scope_max,
                            increments = seriesData.length - 1,
                            incrementAmount;
                        if(increments === 0) {
                            return max;
                        }
                        incrementAmount = max / increments;
                        return Math.floor(100 * (max - index * incrementAmount)) / 100;
                    },
                    "display": "line"
                },
                {
                    "as": "Prediction",
                    "f": function (row, index, summaryMetrics, seriesData) {
                        return null;
                    },
                    "display": "line",
                    "dashStyle": "Dash"
                }
            ];
        },

        getProjectionsConfig: function () {
            return {
                series: [
                    {
                        "as": "Prediction",
                        "field": "To Do"
                    }
                ],
                continueWhile: function (point) {
                    return point.Prediction > 0;
                }
            };
        },

        runCalculation: function (snapshots) {
            var chartData = this.callParent(arguments),
                todayIndex;

            if(new Date() < this.scopeEndDate) {
                this._recomputeIdeal(chartData, this.scopeEndDate);
            }

            if (this.enableProjections && this._projectionsSlopePositive(chartData)) {
                this._removeProjectionSeries(chartData);
            }

            return chartData;
        },

        _recomputeIdeal: function(chartData, endDate) {
             var index;
             if(chartData.categories.length < 1) {
                return;
             }

             var lastDate = Ext.Date.parse(chartData.categories[chartData.categories.length - 1], 'Y-m-d');
             if(endDate > lastDate) {
                // the scopeEndDate date wasn't found in the current categories...we need to extend categories to include it
                // (honoring "workDays").

                index = chartData.categories.length;
                var dt = Ext.Date.add(lastDate, Ext.Date.DAY, 1);
                while (dt < endDate) {
                    while (this.workDays.indexOf(Ext.Date.format(dt, 'l')) === -1) {
                        dt = Ext.Date.add(dt, Ext.Date.DAY, 1);
                    }
                    if (dt < endDate) {
                        chartData.categories[index++] = Ext.Date.format(dt, 'Y-m-d');
                    }
                    dt = Ext.Date.add(dt, Ext.Date.DAY, 1);
                }
                index = chartData.categories.length - 1;
             } else {
                 // it is in "scope"...set index to the index of the last workday in scope
                 index = this._indexOfScopeEnd(chartData, endDate);
                 if(index === -1) {
                    // it's in "scope", but falls on a non-workday...back up to the previous workday
                    while (this.workDays.indexOf(Ext.Date.format(endDate, 'l')) == -1) {
                        endDate = Ext.Date.add(endDate, Ext.Date.DAY, -1);
                        index = this._indexOfScopeEnd(chartData, endDate);
                    }
                 }
             }
             // set first and last point, and let connectNulls fill in the rest
             var i;
             var seriesData = chartData.series[2].data;
             for (i=1;i<index;i++) {
                seriesData[i] = null;
             }
             seriesData[index] = 0;
        },

        _indexOfScopeEnd: function(chartData, scopeEndDate) {
             var endDate = Ext.Date.format(scopeEndDate, 'Y-m-d');
             return chartData.categories.indexOf(endDate);
        },

        _removeFutureSeries: function (chartData, seriesIndex, dayIndex) {
            if(chartData.series[seriesIndex].data.length > dayIndex) {
                while(++dayIndex < chartData.series[seriesIndex].data.length) {
                    chartData.series[seriesIndex].data[dayIndex] = null;
                }
            }
        },

        _projectionsSlopePositive: function (chartData) {
            if(chartData.projections && chartData.projections.series) {
                return chartData.projections.series[0].slope >= 0;
            }

            return true;
        },

        _indexOfNextWorkday: function(chartData, date) {
            var dateStr = Ext.Date.format(date, 'Y-m-d');
            var index = chartData.categories.indexOf(dateStr);
            if(index == -1) {
                while (this.workDays.indexOf(Ext.Date.format(date, 'l')) == -1) {
                    date = Ext.Date.add(date, Ext.Date.DAY, -1);

                }
                dateStr = Ext.Date.format(date, 'Y-m-d');
                index = chartData.categories.indexOf(dateStr) + 1;
            }
            return index;
        },

        _removeProjectionSeries: function (chartData) {
            var series = chartData.series,
                categories = chartData.categories;

            var endDateIndex = this._indexOfNextWorkday(chartData, this.scopeEndDate);

            _.each(series, function (seriesData) {
                seriesData.data = _.first(seriesData.data, endDateIndex + 1);
            });

            chartData.series = _.filter(series, function (seriesData) {
                return seriesData.name != "Prediction";
            });

            chartData.categories = _.first(categories, endDateIndex + 1);
        }
    });
}());
