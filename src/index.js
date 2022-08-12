const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const express = require('express');
const app = express();
var logger = require('morgan');
const {redisClient} = require("./redisClient");
const { UnauthorizedError, ServiceError } = require('web-service-utils/serviceErrors');
const util = require('util')
const jwt = require('jsonwebtoken');
const { getToken } = require('web-service-utils/controller');
const { HttpStatusCodes } = require('web-service-utils/enums');
app.use(logger('dev'));
const verifyAsync = util.promisify(jwt.verify)
const router = express.Router();

// async function removeAccessToken(accessToken){
//     if(accessToken){
//         try {
//             await verifyAsync(accessToken, process.env.ACCESS_TOKEN_SECRET)        
//             await redisClient.pushDenyListJWT(accessToken)
//         } catch (error) {console.log("Error! accessToken will not be added to deny list", accessToken)}
//     }
// }

// async function removeRefreshToken(refreshToken){
//     if(refreshToken){
//         try {
//             await verifyAsync(refreshToken, process.env.REFRESH_TOKEN_SECRET,)        
//             await redisClient.pushDenyListJWT(refreshToken)
//         } catch (error) {console.log("Error! refreshToken will not be added to deny list", refreshToken)}
//     }
// }

// async function signout(accessToken, refreshToken){
//     removeAccessToken(accessToken)
//     removeRefreshToken(refreshToken)
// }
// async function refresh(userId){
//     console.log("refresh", refreshToken)
//     const denyToken = await redisClient.isInDenyListJWT(refreshToken)
//     if (denyToken) throw new UnauthorizedError("Token is in deny list", {token: refreshToken})
    
//     let userId = undefined
//     try {
//         const payload = await verifyAsync(refreshToken, process.env.REFRESH_TOKEN_SECRET)            
//         userId = payload.userId
//     } catch (error) {
//         throw new UnauthorizedError("Token is invalid", {token: refreshToken})  
//     }    
// }


// logout: (async (req, res, next) => {
//     const cookies = req.cookies;
//     const refreshToken = cookies?.jwt;
//     const accessToken = get_to(req)
//     try {
//         await authService.signout(accessToken, refreshToken)
//         res.sendStatus(HttpStatusCodes.OK)
//     } catch (error) {
//        next(error) 
//     }
// })



// check if token is in deny list -> check if token is valid -> check if user is in deny list
async function verify(accessToken){
    console.log("VERIFYING TOKEN: ", accessToken)
    if (!accessToken) throw new UnauthorizedError("Access token missing")
    const isInDenyListJWT = await redisClient.isInDenyListJWT(accessToken)
    if (isInDenyListJWT) throw new UnauthorizedError("Access token is in deny list", {accessToken: accessToken})

    let user = undefined
    try {
        const payload = await verifyAsync(accessToken, process.env.ACCESS_TOKEN_SECRET)
        // console.log("PAYLOAD: ", payload)
        user = payload.user
    } catch (error) {
        throw new UnauthorizedError("Access token is invalid", {accessToken: accessToken})        
    }
    const userId = user._id
    const isInDenyUserList = await redisClient.isInDenyListUserId(userId)
    if (isInDenyUserList) throw new UnauthorizedError("User is in deny list", {accessToken: accessToken, user: user})
    return {user: user, accessToken: accessToken}

}

const verifyAccessToken = (async (req, res, next) => {
    try {
        const accessToken = getToken(req)
        const userToken = await verify(accessToken)
        req.headers.user = JSON.stringify(userToken.user)
        next()                
    } catch (error) {
        next(error)
    }
})

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
    console.log("HEREEE")
    if (req.method !== "POST") await verifyAccessToken(req, res, next)
    next()
})

// check access token for organizations CRUD
router.use('/organizations', verifyAccessToken)


router.use("/auth/logout", async (req, res, next) => {    
    res.sendStatus(HttpStatusCodes.OK)
})
router.use('/auth/refresh', verifyAccessToken)

  
const pathRewrite = function (path, req) { return path.replace('/api', '') }
// proxy users & auth & organizations to IDENTITY_SERVICE
router.use(['/users', '/auth', '/organizations'], createProxyMiddleware({
    target: process.env.IDENTITY_SERVICE, 
    pathRewrite:pathRewrite,
    // onProxyRes:onProxyRes
}), async (req, res, next) =>{})

router.use(async (req, res, next) => {res.sendStatus(404)})

app.use('/api', router)

// PROXY FRONT END SERVER AND SET FRONT END TO REQUEST TO API_GATEWAY TO AVOID CORS
app.get('/*',createProxyMiddleware({target: process.env.FRONT_END}))

// HANDLE ERRORS
app.use(async (error, req, res, next) =>{
    console.log("Handling error...")
    console.log(error)
    if (error instanceof ServiceError){
        res.status(error.httpStatusCode).send({
            message: error.message, 
            value: error.value
        })    
    }else{
        const message = 'Unexpected error'
        console.log(message)
        res.status(HttpStatusCodes.INTERNAL_SERVER).send({
            message: message, 
        })    
    }
})

redisClient.connect()
    .then(app.listen(3000, () => {console.log('API Gateway running!')}))
    .catch("Couldn't start API-Gateway")


