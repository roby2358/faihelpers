import uvicorn

PORT = 8137


def main():
    uvicorn.run("src.main:app", host="0.0.0.0", port=PORT, reload=True)


if __name__ == "__main__":
    main()

