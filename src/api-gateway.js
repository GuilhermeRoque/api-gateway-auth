const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const router = express.Router();
const {verifyAccessToken, logout, refresh} = require('./auth')


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

router.use(["/organizations/:organizationId/applications",
            "/organizations/:organizationId/service-profiles",
            "/organizations/:organizationId/lora-profiles"], 
            createProxyMiddleware({
                target:process.env.DEVICE_MGNT,
                pathRewrite:{ '^/api': ''},
                // pathRewrite:{ '^\/api\/organizations\/[^\/]*': ''} ,
            }),
            async (req, res, next) =>{} )

// proxy users & auth & organizations to IDENTITY_SERVICE
router.use(['/users', '/auth', '/organizations'], 
    createProxyMiddleware({
        target: process.env.IDENTITY_SERVICE, 
        pathRewrite:{ '^/api': ''},
        // onProxyRes:onProxyRes
}), async (req, res, next) =>{})




router.use(async (req, res, next) => {res.sendStatus(404)})


module.exports = router