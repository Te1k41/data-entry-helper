// ============================================================
//  carrier-links.js
//  Vessel Operator (carrier) code → official schedule / route
//  map links. Some carriers have more than one relevant link
//  (e.g. separate schedule pages per trade lane) — those are
//  stored as arrays and the dashboard renders one link per entry.
// ============================================================

const CARRIER_LINKS = {
    YML: { schedule: ["https://e-solution.yangming.com/e-service/schedule/LongTermSchedule.aspx"], routeMap: ["https://www.yangming.com/en/service/service_overview/route_map"] },
    OOC: { schedule: ["https://www.oocl.com/eng/ourservices/eservices/sailingschedule/schedulebyserviceloops/Pages/default.aspx"], routeMap: ["https://www.oocl.com/eng/ourservices/serviceroutes/iat/Pages/default.aspx"] },
    SOM: { schedule: ["http://www.staroceanmarine.com/export/?todo=pdfschedule"], routeMap: [] },
    WAN: { schedule: ["https://www.wanhai.com/views/skd/SkdBySvc.xhtml?file_num=64836&parent_id=64834&top_file_num=64735"], routeMap: [] },
    ONE: { schedule: ["https://ecomm.one-line.com/one-ecom/schedule/long-range-schedule"], routeMap: ["https://www.one-line.com/en/routes/current-services", "https://www.one-line.com/en/service-maps"] },
    SML: { schedule: ["https://esvc.smlines.com/smline/CUP_HOM_3007.do"], routeMap: [] },
    ANL: { schedule: ["https://www.anl.com.au/ebusiness/schedules/line-services/solution", "https://webapps2.anl.com.au/customer/schedules.php"], routeMap: [] },
    CEN: { schedule: ["http://www.newccl.com/en/cqxx.php?riqi=78"], routeMap: [] },
    EVG: { schedule: ["https://ss.shipmentlink.com/tvs2/jsp/TVS2_LongTermMenu.jsp?type=L"], routeMap: ["https://ss.shipmentlink.com/tvs2/jsp/TVS2_LongTermMenu.jsp?type=S"] },
    SIN: { schedule: ["https://ebusiness.sinolines.com.cn/Ebusiness/EQUERY/QueryServiceE.aspx"], routeMap: [] },
    PIL: { schedule: ["https://www.pilship.com/shipping-solutions/service-routes/"], routeMap: ["https://www.pilship.com/shipping-solutions/service-routes/"] },
    CMA: { schedule: ["https://www.cma-cgm.com/ebusiness/schedules/line-services/solution"], routeMap: ["https://www.cma-cgm.com/ebusiness/schedules/line-services/solution"] },
    COS: { schedule: ["https://elines.coscoshipping.com/ebusiness/"], routeMap: [] },
    ZIM: { schedule: ["https://www.zim.com/global-network#trades"], routeMap: ["https://www.zim.com/global-network#trades"] },
    KKC: { schedule: ["https://algesvc.kambara-kisen.co.jp/"], routeMap: [] },
    HL:  { schedule: ["http://www.hapag-lloyd.com/en/home.html"], routeMap: [] },
    HY:  { schedule: ["https://www.hmm21.com/e-service/general/schedule/ScheduleMain.do"], routeMap: ["https://www.hmm21.com/e-service/general/DashBoard.do"] },
    NAM: { schedule: ["https://nsl-japan.co.jp/monthly_schedule/"], routeMap: [] },
    SKR: { schedule: ["https://www.sinokor.co.kr/en/index.html"], routeMap: ["https://ebiz.sinokor.co.kr/Map"] },
    DGJ: { schedule: ["https://esvc.djship.co.kr/"], routeMap: [] },
    TSL: { schedule: ["https://www.tslines.com/hk/newsdetail/SCHEDULE/Vessel-Schedule---Export–"], routeMap: [] },
    CML: { schedule: ["https://www.camellia-line.co.jp/cargo/cargodia/"], routeMap: [] },
    MSK: { schedule: ["https://www.maersk.com/schedules/pointToPoint"], routeMap: ["https://www.maersk.com.cn/local-information"] },
};

module.exports = CARRIER_LINKS;
