package main

import "github.com/gin-gonic/gin"

func RegisterUserRoutes(router gin.IRouter) {
	users := router.Group(
		"/users",
	)
	users.Use(
		AuthMiddleware(),
	)
	users.GET(
		"/",
		listUsers,
	)
	users.POST(
		"/",
		createUser,
	)
	users.GET(
		"/:id",
		getUser,
	)
	users.PUT(
		"/:id",
		updateUser,
	)
	users.DELETE(
		"/:id",
		deleteUser,
	)
	users.GET(
		"/me",
		getMe,
	)
}
