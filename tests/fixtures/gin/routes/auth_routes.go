package main

import "github.com/gin-gonic/gin"

func RegisterAuthRoutes(router gin.IRouter) {
	auth := router.Group(
		"/auth",
	)
	auth.POST(
		"/login",
		login,
	)
	auth.POST(
		"/register",
		register,
	)
}
