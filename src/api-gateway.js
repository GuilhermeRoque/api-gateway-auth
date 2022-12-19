const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const { HttpStatusCodes } = require('web-service-utils/enums');
const router = express.Router();
const {verifyAccessToken, logout, refresh} = require('./auth')
const axios = require('axios')
const crypto = require("crypto")



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
    target:process.env.DATA_ANALYTICS,
    pathRewrite:{ '^/api': ''},
})
)

router.use(["/organizations/:organizationId/applications",
            "/organizations/:organizationId/service-profiles",
            "/organizations/:organizationId/lora-profiles"], 
            createProxyMiddleware({
                target:process.env.DEVICE_MGNT,
                pathRewrite:{ '^/api': ''},
                // pathRewrite:{ '^\/api\/organizations\/[^\/]*': ''} ,
            }),
            async (req, res, next) =>{})

router.get("/organizations/:organizationId/device-profiles", async (req, res, next) =>{
    const orgId = req.params.organizationId
    const paths = [
        `${process.env.DEVICE_MGNT}/organizations/${orgId}/applications`,
        `${process.env.DEVICE_MGNT}/organizations/${orgId}/service-profiles`,
        `${process.env.DEVICE_MGNT}/organizations/${orgId}/lora-profiles`
    ]
    const requests = paths.map((p,i)=>axios.get(p))
    axios.all(requests).then(axios.spread((...responses) => {
        res.status(200).send({
            applications: responses[0].data,
            serviceProfiles: responses[1].data,
            loraProfiles: responses[2].data,
        })
      })).catch(errors => {
          res.status(500).send({message: "Error getting device profiles", error: errors})      
      })
})


router.post('/organizations', express.json(), async (req, res, next) => {
    const config = {
        headers: {
            "Authorization": `Bearer ${process.env.INFLUX_TOKEN}`
        }
    }
    try {
        const respInlfluxOrg = await axios.post(`${process.env.INFLUX_URL}/api/v2/orgs`, req.body, config)
        const orgID = respInlfluxOrg.data.id
        const bucket = "Sensor Data"
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
        timeSeriesData = {
            organizationId: respIdentity.data.organization._id,
            organizationDataId: respInlfluxOrg.data.id,
            bucket: respInfluxOrgBucket.data.id,
            token: resResources.data.token,
            username: respUser.data.name,
            password: password
        }
        console.log("data", timeSeriesData)
        console.log("data", respIdentity.data)
        const respDeviceMgnt = await axios.post(`${process.env.DEVICE_MGNT}/organizations`, timeSeriesData, {headers: {user: req.headers.user}})

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