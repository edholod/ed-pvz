from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from archive_worker import router

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,allow_origins=['https://edpvz.ru'],allow_methods=['GET','POST','OPTIONS'],allow_headers=['authorization','apikey','content-type','range'],expose_headers=['Content-Disposition','Content-Length','Content-Range','Accept-Ranges'])
app.include_router(router)

@app.get('/')
async def index():
    return {'service':'edpvz-archive','ok':True}
