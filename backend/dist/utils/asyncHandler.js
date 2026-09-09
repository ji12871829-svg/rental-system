"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = asyncHandler;
// Routes never try/catch themselves — async errors flow to the central
// error handler through this wrapper.
function asyncHandler(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
//# sourceMappingURL=asyncHandler.js.map