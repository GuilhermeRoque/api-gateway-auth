const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const { HttpStatusCodes } = require('web-service-utils/enums');
const router = express.Router();
const {verifyAccessToken, logout, refresh} = require('./auth')
const axios = require('axios')
const crypto = require("crypto");
const redisClient = require('./redisClient').redisClient;



// if we are in handling CORS allow it for CLIENT_ENTRYPOINT_URL
router.use(async (req, res, next) => {
    if(req.method === 'OPTIONS'){
        res.header("Access-Control-Allow-Origin", process.env.CLIENT_ENTRYPOINT_URL);
        res.header("Access-Control-Allow-Headers", "authorization, content-type");
        res.header("Access-Control-Expose-Headers", "authorization, content-type");
        res.header("Access-Control-Allow-Methods", "*");
        res.header("Access-Control-Allow-Credentials", "true")
        res.sendStatus(HttpStatusCodes.OK);    
    }else{
        next()
    }
});

// check access token if method !== POST (POST WILL CREATE THE USER)
router.use("/users", async (req, res, next) => {    
    if (req.method !== "POST") await verifyAccessToken(req, res, next)
    next()
})

// check access token for organizations CRUD
router.use('/organizations', verifyAccessToken)

router.use("/auth/logout", logout)
router.use('/auth/refresh', refresh)  

router.use("/organizations/:organizationId/export-sensor-data/devices/:deviceId",
createProxyMiddleware({
    target:process.env.DATA_ANALYSER,
    pathRewrite: (async (path, req)=>{
        let newPath = path.replace(/^\/api/, '')
        let orgKey = req.params.organizationId
        let orgInflux = await redisClient.getOrgInflux(orgKey)
        newPath = newPath.replace(/(?<=organizations\/)(.*?)(?=\/)/, orgInflux)
        return newPath
    }
)}))

router.use(["/organizations/:organizationId/applications",
            "/organizations/:organizationId/service-profiles",
            "/organizations/:organizationId/lora-profiles",
            "/organizations/:organizationId/device-profiles"], 
            createProxyMiddleware({
                target:process.env.APP_MGR,
                pathRewrite: (async (path, req)=>{
                    let newPath = path.replace(/^\/api/, '')
                    let orgKey = req.params.organizationId
                    let orgInflux = await redisClient.getOrgAppMgnt(orgKey)
                    newPath = newPath.replace(/(?<=organizations\/)(.*?)(?=\/)/, orgInflux)
                    newPath = newPath.replace(/\/device-profiles/,'')
                    return newPath
                }
            )}),

            async (req, res, next) =>{})

router.post('/organizations', express.json(), async (req, res, next) => {
    const config = {
        headers: {
            "Authorization": `Bearer ${process.env.INFLUX_TOKEN}`
        }
    }
    try {
        console.log("POST TO",`${process.env.INFLUX_URL}/api/v2/orgs`)
        const respInlfluxOrg = await axios.post(`${process.env.INFLUX_URL}/api/v2/orgs`, req.body, config)
        const orgID = respInlfluxOrg.data.id
        const bucket = process.env.INFLUX_BUCKET
        const respInfluxOrgBucket = await axios.post(`${process.env.INFLUX_URL}/api/v2/buckets`, {
            description: "LoRaWAN A.P sensor data bucket",
            name: bucket,
            orgID: orgID,
            retentionRules: [{
                everySeconds: 0,
                type: "expire"
            }]
        }, config)
        const bucketID = respInfluxOrgBucket.data.id
        const respUser = await axios.post(`${process.env.INFLUX_URL}/api/v2/users`, {
            name: req.body.name,
            status: "active"
        }, config)
        const userID = respUser.data.id

        const influxResources = [
            "authorizations",
            "buckets",
            "dashboards",
            "orgs",
            "tasks",
            "telegrafs",
            "users",
            "variables",
            "secrets",
            "labels",
            "views",
            "documents",
            "notificationRules",
            "notificationEndpoints",
            "checks",
            "dbrp",
            "annotations",
            "sources",
            "scrapers",
            "notebooks",
            "remotes",
            "replications",
        ]
        const permissions = ['read', 'write']
        
        const reqPermissions = []
        for(const resource of influxResources){
            for(const permission of permissions){
                reqPermissions.push(
                    {
                        action: permission,
                        resource: {
                            orgID: orgID,
                            type: resource,
                        }
                    }
                )    
            }
        }

        
        const resResources = await axios.post(
            `${process.env.INFLUX_URL}/api/v2/authorizations`,
            {
                description: `Full permission org ${orgID} user ${userID}`,
                orgID: orgID,
                userID: userID,
                permissions: reqPermissions,
                status: "active"
            },
            config
        )

        const password = crypto.randomBytes(20).toString('hex')

        const respUserPassword = await axios.post(`${process.env.INFLUX_URL}/api/v2/users/${userID}/password`, {
            password: password
        }, config)


        const respUserOwner = await axios.post(`${process.env.INFLUX_URL}/api/v2/orgs/${orgID}/owners`, {
            id: userID
        }, config)


        const respIdentity = await axios.post(`${process.env.IDENTITY_SERVICE}/organizations`, req.body, {headers: {user: req.headers.user}})
        const orgIdentity = respIdentity.data.organization._id
        timeSeriesData = {
            organizationId: orgIdentity,
            organizationDataId: respInlfluxOrg.data.id,
            bucket: respInfluxOrgBucket.data.id,
            token: resResources.data.token,
            username: respUser.data.name,
            password: password
        }
        console.log("datatimeSeriesData", timeSeriesData)
        console.log("datarespIdentity", respIdentity.data)
        const respDeviceMgnt = await axios.post(`${process.env.APP_MGR}/organizations`, timeSeriesData, {headers: {user: req.headers.user}})
        console.log("respDeviceMgnt", respDeviceMgnt.data)
        const orgAppMgnt = respDeviceMgnt.data._id
        
        await redisClient.setOrgAppMgnt(orgIdentity, orgAppMgnt)
        await redisClient.setOrgInflux(orgIdentity, orgID)

        res.status(201).send(respIdentity.data)

    } catch (error) {
        console.log(error)
        res.status(500).send(error)
    }

})


// proxy users & auth & organizations to IDENTITY_SERVICE
router.use(['/users', '/auth', '/organizations'], 
    createProxyMiddleware({
        target: process.env.IDENTITY_SERVICE, 
        pathRewrite:{ '^/api': ''},
        // onProxyRes:onProxyRes
}), async (req, res, next) =>{})


router.use(async (req, res, next) => {res.sendStatus(404)})


module.exports = router